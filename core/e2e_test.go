package labocore

// Tests DE BOUT EN BOUT de chaque adaptateur : un VRAI serveur du moteur, puis le cœur LaboSurfVPN
// configuré UNIQUEMENT avec le lien / profil tel que PRO l'émet, puis des octets dans les deux sens
// jusqu'à une cible locale (bannière puis écho). Seule différence avec le téléphone : l'entrée est un
// SOCKS local au lieu de l'interface TUN (impossible sans appareil Android).
//
//	SSH, SSH-SSL, SSH-HTTP, WireGuard : serveurs Go dans le test (toujours exécutés)
//	Xray, Hysteria2, TUIC : binaires OFFICIELS épinglés par SHA-256 (mêmes versions que LABOSURF PRO),
//	exécutés seulement avec LABOSURF_TEST_REAL=1 (réseau requis), en CI Linux.

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/ssh"
	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun/netstack"
)

const testSNI = "vpn.example.test"

// ------------------------------------------------------------------ outils communs

func freePort(t *testing.T, network string) int {
	t.Helper()
	if network == "udp" {
		c, err := net.ListenPacket("udp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		return c.LocalAddr().(*net.UDPAddr).Port
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// echoTarget : cible TCP locale qui écrit une bannière puis renvoie l'écho.
func echoTarget(t *testing.T, ln net.Listener, banner string) {
	t.Helper()
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_, _ = c.Write([]byte(banner + "\n"))
				_, _ = io.Copy(c, c)
			}(c)
		}
	}()
}

func localEcho(t *testing.T, banner string) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	echoTarget(t, ln, banner)
	return ln.Addr().(*net.TCPAddr).Port
}

// testCert : certificat auto-signé pour testSNI ; retourne (cert.pem, key.pem, empreinte hex, tls.Certificate).
func testCert(t *testing.T) (string, string, string, tls.Certificate) {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: testSNI},
		DNSNames: []string{testSNI}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	kd, _ := x509.MarshalECPrivateKey(key)
	dir := t.TempDir()
	cp, kp := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kd})
	_ = os.WriteFile(cp, certPEM, 0o644)
	_ = os.WriteFile(kp, keyPEM, 0o600)
	pair, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(der)
	return cp, kp, hex.EncodeToString(sum[:]), pair
}

// throughCore démarre le cœur (entrée SOCKS) avec la configuration donnée, puis vérifie bannière et
// écho jusqu'à 127.0.0.1:target à travers le moteur.
func throughCore(t *testing.T, configJSON string, target int, banner string) {
	t.Helper()
	sp := freePort(t, "tcp")
	err := start(configJSON, map[string]any{"tag": inboundTag, "protocol": "socks", "listen": "127.0.0.1", "port": sp,
		"settings": map[string]any{"auth": "noauth", "udp": true}})
	if err != nil {
		t.Fatalf("démarrage du cœur : %v", err)
	}
	t.Cleanup(Stop)
	var c net.Conn
	deadline := time.Now().Add(20 * time.Second)
	for {
		c, err = net.DialTimeout("tcp", joinHostPort("127.0.0.1", sp), time.Second)
		if err == nil || time.Now().After(deadline) {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("entrée du cœur jamais prête : %v", err)
	}
	c.Close()
	conn := socksConnect(t, sp, target)
	defer conn.Close()
	r := bufio.NewReader(conn)
	if l, err := r.ReadString('\n'); err != nil || strings.TrimSpace(l) != banner {
		t.Fatalf("bannière non reçue à travers le moteur : %q %v", l, err)
	}
	if _, err := conn.Write([]byte("aller-retour\n")); err != nil {
		t.Fatal(err)
	}
	if l, err := r.ReadString('\n'); err != nil || l != "aller-retour\n" {
		t.Fatalf("écho non reçu : %q %v", l, err)
	}
	var st struct{ Rx, Tx int64 }
	_ = json.Unmarshal([]byte(Stats()), &st)
	if st.Rx <= 0 || st.Tx <= 0 {
		t.Fatalf("trafic non mesuré : %s", Stats())
	}
	t.Logf("✓ octets relayés dans les deux sens, mesurés : %s", Stats())
	// Preuve de l'application (Probe) : vraie requête DNS jusqu'à 1.1.1.1 par le moteur (réseau requis).
	if os.Getenv("LABOSURF_TEST_PROBE") == "1" || os.Getenv("LABOSURF_TEST_REAL") == "1" {
		if err := Probe(); err != nil {
			t.Fatalf("sonde DNS à travers le moteur : %v", err)
		}
		t.Log("✓ sonde : requête DNS réelle jusqu'à 1.1.1.1 à travers le moteur")
	}
}

func cfgJSON(engine, uri string, profile map[string]any) string {
	b, _ := json.Marshal(map[string]any{"proto": engine, "uri": uri, "profile": profile})
	return string(b)
}

// ------------------------------------------------------------------ SSH, SSH-SSL, SSH-HTTP

// sshTestServer : serveur SSH acceptant la clé de l'abonné et les redirections direct-tcpip, derrière
// le transport du moteur (TCP, TLS ou requête HTTP du modèle get-upgrade).
func sshTestServer(t *testing.T, mode string, clientPub ssh.PublicKey, cert tls.Certificate) (int, ssh.PublicKey) {
	t.Helper()
	_, hostPriv, _ := ed25519.GenerateKey(rand.Reader)
	hostSigner, _ := ssh.NewSignerFromKey(hostPriv)
	cfg := &ssh.ServerConfig{PublicKeyCallback: func(_ ssh.ConnMetadata, k ssh.PublicKey) (*ssh.Permissions, error) {
		if bytes.Equal(k.Marshal(), clientPub.Marshal()) {
			return nil, nil
		}
		return nil, fmt.Errorf("clé refusée")
	}}
	cfg.AddHostKey(hostSigner)
	var ln net.Listener
	var err error
	if mode == "shssl" {
		ln, err = tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{cert}})
	} else {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				var rd io.Reader = c
				if mode == "sshhttp" {
					br := bufio.NewReader(c)
					for {
						l, err := br.ReadString('\n')
						if err != nil {
							c.Close()
							return
						}
						if strings.TrimRight(l, "\r\n") == "" {
							break
						}
					}
					_, _ = c.Write([]byte("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: labosurf-ssh/1\r\n\r\n"))
					rd = br
				}
				sc, chans, reqs, err := ssh.NewServerConn(&readerConn{Conn: c, r: rd}, cfg)
				if err != nil {
					c.Close()
					return
				}
				defer sc.Close()
				go ssh.DiscardRequests(reqs)
				for nc := range chans {
					if nc.ChannelType() != "direct-tcpip" {
						nc.Reject(ssh.UnknownChannelType, "")
						continue
					}
					var p struct {
						Host  string
						Port  uint32
						OHost string
						OPort uint32
					}
					_ = ssh.Unmarshal(nc.ExtraData(), &p)
					dst, err := net.Dial("tcp", joinHostPort(p.Host, int(p.Port)))
					if err != nil {
						nc.Reject(ssh.ConnectionFailed, "")
						continue
					}
					ch, creqs, _ := nc.Accept()
					go ssh.DiscardRequests(creqs)
					go func() { defer ch.Close(); defer dst.Close(); go io.Copy(dst, ch); _, _ = io.Copy(ch, dst) }()
				}
			}(c)
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, hostSigner.PublicKey()
}

type readerConn struct {
	net.Conn
	r io.Reader
}

func (c *readerConn) Read(p []byte) (int, error) { return c.r.Read(p) }

func TestSSHFamilyThroughTheCore(t *testing.T) {
	_, certPEM, pin, cert := testCert(t)
	_ = certPEM
	for _, engine := range []string{"ssh", "shssl", "sshhttp"} {
		t.Run(engine, func(t *testing.T) {
			_, priv, _ := ed25519.GenerateKey(rand.Reader)
			signer, _ := ssh.NewSignerFromKey(priv)
			port, hostKey := sshTestServer(t, engine, signer.PublicKey(), cert)
			block, err := ssh.MarshalPrivateKey(priv, "fs-u1@labosurf")
			if err != nil {
				t.Fatal(err)
			}
			profile := map[string]any{ // champs du profil émis par PRO (internal/clientcfg)
				"type": engine, "host": "127.0.0.1", "port": float64(port), "username": "fs-u1", "auth": "publickey",
				"private_key_openssh": string(pem.EncodeToMemory(block)),
				"host_key":            strings.TrimSpace(string(ssh.MarshalAuthorizedKey(hostKey))),
			}
			switch engine {
			case "shssl":
				profile["sni"], profile["tls_cert_sha256"], profile["tls_verify"] = testSNI, pin, "pin-sha256"
			case "sshhttp":
				profile["transport"] = "get-upgrade"
				profile["http_payload"] = fmt.Sprintf("GET / HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nConnection: Upgrade\r\nUpgrade: labosurf-ssh/1\r\n\r\n", port)
			}
			banner := "LABOSURF-" + strings.ToUpper(engine)
			throughCore(t, cfgJSON(engine, "", profile), localEcho(t, banner), banner)
		})
	}
	// Une clé de serveur différente de celle du profil : connexion refusée (jamais d'acceptation aveugle).
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(priv)
	port, _ := sshTestServer(t, "ssh", signer.PublicKey(), cert)
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	otherSigner, _ := ssh.NewSignerFromKey(other)
	block, _ := ssh.MarshalPrivateKey(priv, "x")
	c, err := newSSHClient("ssh", map[string]any{"host": "127.0.0.1", "port": float64(port), "username": "u",
		"private_key_openssh": string(pem.EncodeToMemory(block)),
		"host_key":            strings.TrimSpace(string(ssh.MarshalAuthorizedKey(otherSigner.PublicKey())))})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if _, err := c.dial(context.Background(), "127.0.0.1:9"); err == nil {
		t.Fatal("clé de serveur inattendue acceptée")
	}
}

// ------------------------------------------------------------------ WireGuard

func wgKeys() (priv, pub [32]byte) {
	_, _ = rand.Read(priv[:])
	priv[0] &= 248
	priv[31] = (priv[31] & 127) | 64
	p, _ := curve25519.X25519(priv[:], curve25519.Basepoint)
	copy(pub[:], p)
	return
}

func TestWireGuardThroughTheCore(t *testing.T) {
	srvPriv, srvPub := wgKeys()
	cliPriv, cliPub := wgKeys()
	tunDev, tnet, err := netstack.CreateNetTUN([]netip.Addr{netip.MustParseAddr("10.66.0.1")}, nil, 1420)
	if err != nil {
		t.Fatal(err)
	}
	dev := device.NewDevice(tunDev, conn.NewDefaultBind(), device.NewLogger(device.LogLevelSilent, ""))
	t.Cleanup(dev.Close)
	port := freePort(t, "udp")
	if err := dev.IpcSet(fmt.Sprintf("private_key=%s\nlisten_port=%d\npublic_key=%s\nallowed_ip=10.66.0.2/32\n",
		hex.EncodeToString(srvPriv[:]), port, hex.EncodeToString(cliPub[:]))); err != nil {
		t.Fatal(err)
	}
	if err := dev.Up(); err != nil {
		t.Fatal(err)
	}
	ln, err := tnet.ListenTCP(&net.TCPAddr{IP: net.ParseIP("10.66.0.1"), Port: 9000})
	if err != nil {
		t.Fatal(err)
	}
	echoTarget(t, ln, "LABOSURF-WIREGUARD")
	// Fichier wg-quick au format émis par PRO (wireguardClientConfigFromSecrets).
	conf := fmt.Sprintf("[Interface]\nPrivateKey = %s\nAddress = 10.66.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = %s\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = 127.0.0.1:%d\nPersistentKeepalive = 25\n",
		base64.StdEncoding.EncodeToString(cliPriv[:]), base64.StdEncoding.EncodeToString(srvPub[:]), port)
	sp := freePort(t, "tcp")
	if err := start(cfgJSON("wireguard", conf, nil), map[string]any{"tag": inboundTag, "protocol": "socks", "listen": "127.0.0.1", "port": sp,
		"settings": map[string]any{"auth": "noauth", "udp": true}}); err != nil {
		t.Fatalf("démarrage du cœur : %v", err)
	}
	t.Cleanup(Stop)
	time.Sleep(time.Second)
	c := socksConnectAddr(t, sp, []byte{10, 66, 0, 1}, 9000)
	defer c.Close()
	r := bufio.NewReader(c)
	if l, err := r.ReadString('\n'); err != nil || strings.TrimSpace(l) != "LABOSURF-WIREGUARD" {
		t.Fatalf("bannière à travers WireGuard : %q %v", l, err)
	}
	_, _ = c.Write([]byte("wg\n"))
	if l, err := r.ReadString('\n'); err != nil || l != "wg\n" {
		t.Fatalf("écho WireGuard : %q %v", l, err)
	}
}

func socksConnectAddr(t *testing.T, socksPort int, ip []byte, port int) net.Conn {
	t.Helper()
	c, err := net.DialTimeout("tcp", joinHostPort("127.0.0.1", socksPort), 3*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_ = c.SetDeadline(time.Now().Add(20 * time.Second))
	_, _ = c.Write([]byte{5, 1, 0})
	b := make([]byte, 2)
	if _, err := io.ReadFull(c, b); err != nil {
		t.Fatal(err)
	}
	_, _ = c.Write(append(append([]byte{5, 1, 0, 1}, ip...), byte(port>>8), byte(port)))
	rep := make([]byte, 10)
	if _, err := io.ReadFull(c, rep); err != nil || rep[1] != 0 {
		t.Fatalf("socks CONNECT : %v %v", rep, err)
	}
	return c
}

// ------------------------------------------------------------------ binaires officiels (CI)

func needReal(t *testing.T) {
	t.Helper()
	if os.Getenv("LABOSURF_TEST_REAL") != "1" || runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
		t.Skip("serveur officiel requis : LABOSURF_TEST_REAL=1 sur Linux amd64 (CI)")
	}
}

// fetchVerified télécharge url une fois et vérifie son SHA-256 (empreintes épinglées par LABOSURF PRO).
func fetchVerified(t *testing.T, url, sum string) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("téléchargement %s : %v", url, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("téléchargement %s : %d %v", url, resp.StatusCode, err)
	}
	got := sha256.Sum256(b)
	if hex.EncodeToString(got[:]) != sum {
		t.Fatalf("empreinte inattendue pour %s", url)
	}
	return b
}

func writeExec(t *testing.T, b []byte, name string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, b, 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func runServer(t *testing.T, bin string, args ...string) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, bin, args...)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cancel()
		_ = cmd.Wait()
		if t.Failed() {
			t.Logf("journal du serveur :\n%s", out.String())
		}
	})
	time.Sleep(1500 * time.Millisecond)
}

func xrayBinary(t *testing.T) string {
	t.Helper()
	zb := fetchVerified(t, "https://github.com/XTLS/Xray-core/releases/download/v26.3.27/Xray-linux-64.zip",
		"23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae")
	zr, err := zip.NewReader(bytes.NewReader(zb), int64(len(zb)))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range zr.File {
		if f.Name == "xray" {
			rc, _ := f.Open()
			b, _ := io.ReadAll(rc)
			rc.Close()
			return writeExec(t, b, "xray")
		}
	}
	t.Fatal("xray absent de l'archive")
	return ""
}

func TestRealXrayVariantsThroughTheCore(t *testing.T) {
	needReal(t)
	bin := xrayBinary(t)
	cp, kp, pin, _ := testCert(t)
	// Clés REALITY jetables, générées ici (format d'Xray : X25519 en base64url sans remplissage).
	k, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	privKey := base64.RawURLEncoding.EncodeToString(k.Bytes())
	pubKey := base64.RawURLEncoding.EncodeToString(k.PublicKey().Bytes())
	const id = "0b6f1b4a-5c2e-4c47-9d1a-2a4f0e7b3c11"
	for _, v := range []struct{ network, security string }{
		{"tcp", "reality"}, {"tcp", "tls"}, {"tcp", "none"}, {"ws", "tls"}, {"ws", "none"},
		{"xhttp", "tls"}, {"xhttp", "none"}, {"grpc", "tls"}, {"grpc", "none"},
	} {
		t.Run(v.network+"+"+v.security, func(t *testing.T) {
			port := freePort(t, "tcp")
			flow := ""
			if v.network == "tcp" && v.security != "none" {
				flow = "xtls-rprx-vision"
			}
			stream := map[string]any{"network": v.network, "security": v.security}
			q := []string{"encryption=none", "security=" + v.security, "type=" + v.network}
			switch v.security {
			case "tls":
				stream["tlsSettings"] = map[string]any{"serverName": testSNI, "certificates": []any{map[string]any{"certificateFile": cp, "keyFile": kp}}}
				q = append(q, "sni="+testSNI, "fp=chrome", "pcs="+pin)
			case "reality":
				stream["realitySettings"] = map[string]any{"dest": "dl.google.com:443", "serverNames": []string{"dl.google.com"}, "privateKey": privKey, "shortIds": []string{""}}
				q = append(q, "sni=dl.google.com", "fp=chrome", "pbk="+pubKey, "sid=")
			}
			switch v.network {
			case "ws":
				stream["wsSettings"] = map[string]any{"path": "/ls"}
				q = append(q, "path=%2Fls")
			case "xhttp":
				stream["xhttpSettings"] = map[string]any{"path": "/lx", "mode": "auto"}
				q = append(q, "path=%2Flx", "mode=auto")
			case "grpc":
				stream["grpcSettings"] = map[string]any{"serviceName": "lsgrpc"}
				q = append(q, "serviceName=lsgrpc", "mode=gun")
			}
			if flow != "" {
				q = append(q, "flow="+flow)
			}
			client := map[string]any{"id": id, "flow": flow}
			srv := map[string]any{
				"log":       map[string]any{"loglevel": "warning"},
				"inbounds":  []any{map[string]any{"listen": "127.0.0.1", "port": port, "protocol": "vless", "settings": map[string]any{"clients": []any{client}, "decryption": "none"}, "streamSettings": stream}},
				"outbounds": []any{map[string]any{"protocol": "freedom"}},
			}
			raw, _ := json.Marshal(srv)
			cfgPath := filepath.Join(t.TempDir(), "server.json")
			_ = os.WriteFile(cfgPath, raw, 0o600)
			runServer(t, bin, "run", "-config", cfgPath)
			link := fmt.Sprintf("vless://%s@127.0.0.1:%d?%s#LABOSURF", id, port, strings.Join(q, "&"))
			banner := "LABOSURF-XRAY-" + strings.ToUpper(v.network+"-"+v.security)
			throughCore(t, cfgJSON("xray", link, nil), localEcho(t, banner), banner)
		})
	}
}

func TestRealHysteria2ThroughTheCore(t *testing.T) {
	needReal(t)
	b := fetchVerified(t, "https://github.com/HyNetworks/hysteria/releases/download/app/v2.12.2/hysteria-linux-amd64",
		"6493dfffd55b5883f64c76c63880ecc32988f0c568c9ca9014907877b4d55f94")
	bin := writeExec(t, b, "hysteria")
	cp, kp, pin, _ := testCert(t)
	port := freePort(t, "udp")
	yaml := fmt.Sprintf("listen: 127.0.0.1:%d\ntls:\n  cert: %s\n  key: %s\nauth:\n  type: userpass\n  userpass:\n    fs-u1: motdepasse\nobfs:\n  type: salamander\n  salamander:\n    password: obfs-secret\n", port, cp, kp)
	cfgPath := filepath.Join(t.TempDir(), "config.yaml")
	_ = os.WriteFile(cfgPath, []byte(yaml), 0o600)
	runServer(t, bin, "server", "-c", cfgPath)
	// Lien au format de PRO (hysteria2Link) + empreinte.
	link := fmt.Sprintf("hysteria2://fs-u1:motdepasse@127.0.0.1:%d/?insecure=1&obfs=salamander&obfs-password=obfs-secret&pinSHA256=%s&sni=%s#LABOSURF", port, pin, testSNI)
	throughCore(t, cfgJSON("hysteria2", link, nil), localEcho(t, "LABOSURF-HYSTERIA2"), "LABOSURF-HYSTERIA2")
}

func TestRealTUICThroughTheCore(t *testing.T) {
	needReal(t)
	b := fetchVerified(t, "https://github.com/tuic-protocol/tuic/releases/download/tuic-server-1.0.0/tuic-server-1.0.0-x86_64-unknown-linux-musl",
		"adb808944ca829857bf408d2ee438a156e8171543dbbed3e94964b66b4135393")
	bin := writeExec(t, b, "tuic-server")
	cp, kp, pin, _ := testCert(t)
	port := freePort(t, "udp")
	const id = "11111111-2222-3333-4444-555555555555"
	cfg, _ := json.Marshal(map[string]any{"server": fmt.Sprintf("127.0.0.1:%d", port), "users": map[string]string{id: "motdepasse"},
		"certificate": cp, "private_key": kp, "congestion_control": "bbr", "alpn": []string{"h3"}, "log_level": "warn"})
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	_ = os.WriteFile(cfgPath, cfg, 0o600)
	runServer(t, bin, "-c", cfgPath)
	// Lien au format de PRO (tuicLink) + empreinte.
	link := fmt.Sprintf("tuic://%s:motdepasse@127.0.0.1:%d?congestion_control=bbr&alpn=h3&sni=%s&allow_insecure=1&udp_relay_mode=native&pin_sha256=%s#LABOSURF", id, port, testSNI, pin)
	throughCore(t, cfgJSON("tuic", link, nil), localEcho(t, "LABOSURF-TUIC"), "LABOSURF-TUIC")
}
