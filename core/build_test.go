package labocore

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

// Liens tels que LABOSURF PRO les émet (formats de internal/clientcfg de PRO), traduits en sortie Xray.
func TestVLESSLinksOfEveryVariant(t *testing.T) {
	for name, c := range map[string]struct {
		link           string
		network, sec   string
		flow, extraKey string
	}{
		"tcp+reality": {"vless://U@203.0.113.5:8444?encryption=none&flow=xtls-rprx-vision&security=reality&sni=dl.google.com&fp=chrome&pbk=PUB&sid=&type=tcp&headerType=none#LABOSURF", "tcp", "reality", "xtls-rprx-vision", "realitySettings"},
		"tcp+tls":     {"vless://U@vpn.example.com:443?encryption=none&flow=xtls-rprx-vision&security=tls&sni=vpn.example.com&fp=chrome&type=tcp&headerType=none#LABOSURF", "tcp", "tls", "xtls-rprx-vision", "tlsSettings"},
		"tcp+none":    {"vless://U@203.0.113.5:8444?encryption=none&security=none&type=tcp&headerType=none#LABOSURF", "tcp", "none", "", ""},
		"ws+tls":      {"vless://U@vpn.example.com:443?encryption=none&security=tls&sni=vpn.example.com&fp=chrome&type=ws&path=%2Fls&host=cdn.example.com#LABOSURF", "ws", "tls", "", "wsSettings"},
		"xhttp+none":  {"vless://U@vpn.example.com:8080?encryption=none&security=none&type=xhttp&path=%2Fx&mode=auto#LABOSURF", "xhttp", "none", "", "xhttpSettings"},
		"grpc+tls":    {"vless://U@vpn.example.com:443?encryption=none&security=tls&sni=vpn.example.com&fp=chrome&type=grpc&mode=gun&serviceName=lsgrpc#LABOSURF", "grpc", "tls", "", "grpcSettings"},
	} {
		ob, err := vlessOutbound(c.link)
		if err != nil {
			t.Fatalf("%s : %v", name, err)
		}
		st := ob["streamSettings"].(map[string]any)
		if st["network"] != c.network || st["security"] != c.sec {
			t.Errorf("%s : flux %v", name, st)
		}
		if c.extraKey != "" && st[c.extraKey] == nil {
			t.Errorf("%s : %s absent", name, c.extraKey)
		}
		user := ob["settings"].(map[string]any)["vnext"].([]any)[0].(map[string]any)["users"].([]any)[0].(map[string]any)
		if (user["flow"] != nil) != (c.flow != "") || (c.flow != "" && user["flow"] != c.flow) {
			t.Errorf("%s : flow %v", name, user["flow"])
		}
	}
	for _, bad := range []string{"vless://203.0.113.5:8444", "trojan://u@h:1", "vless://U@h:1?security=reality&sni=x", "vless://U@h:1?type=kcp"} {
		if _, err := vlessOutbound(bad); err == nil {
			t.Errorf("lien invalide accepté : %s", bad)
		}
	}
}

func TestHysteria2LinkNeedsAPinnedCertificate(t *testing.T) {
	base := "hysteria2://fs-u1:pw@203.0.113.5:8445?insecure=1&obfs=salamander&obfs-password=OB&sni=203.0.113.5"
	if _, err := hysteria2Outbound(base + "#LABOSURF"); err == nil || !strings.Contains(err.Error(), "empreinte") {
		t.Fatalf("sans empreinte : refus attendu, obtenu %v", err)
	}
	ob, err := hysteria2Outbound(base + "&pinSHA256=" + strings.Repeat("ab", 32) + "#LABOSURF")
	if err != nil {
		t.Fatal(err)
	}
	st := ob["streamSettings"].(map[string]any)
	if st["hysteriaSettings"].(map[string]any)["auth"] != "fs-u1:pw" || st["finalmask"] == nil {
		t.Fatalf("hysteria2 : %v", st)
	}
	if st["tlsSettings"].(map[string]any)["pinnedPeerCertSha256"] != strings.Repeat("ab", 32) {
		t.Fatal("empreinte non transmise")
	}
}

func TestWireGuardConfFromPRO(t *testing.T) {
	conf := "[Interface]\nPrivateKey = PRIV\nAddress = 10.66.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = PUB\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = 203.0.113.5:51820\nPersistentKeepalive = 25\n"
	ob, err := wireguardOutbound(conf)
	if err != nil {
		t.Fatal(err)
	}
	s := ob["settings"].(map[string]any)
	peer := s["peers"].([]any)[0].(map[string]any)
	if s["secretKey"] != "PRIV" || peer["publicKey"] != "PUB" || peer["endpoint"] != "203.0.113.5:51820" {
		t.Fatalf("wireguard : %v", s)
	}
	if _, err := wireguardOutbound("[Interface]\nPrivateKey = X\n"); err == nil {
		t.Fatal("configuration incomplète acceptée")
	}
}

func TestTUICLinkNeedsPinAndValidUUID(t *testing.T) {
	ok := "tuic://11111111-2222-3333-4444-555555555555:pw@203.0.113.5:443?congestion_control=bbr&alpn=h3&sni=203.0.113.5&allow_insecure=1&udp_relay_mode=native&pin_sha256=" + strings.Repeat("cd", 32) + "#LABOSURF"
	c, err := newTUICClient(ok)
	if err != nil || c.addr != "203.0.113.5:443" || c.tls.NextProtos[0] != "h3" {
		t.Fatalf("lien tuic valide refusé : %v", err)
	}
	if _, err := newTUICClient(strings.Replace(ok, "&pin_sha256="+strings.Repeat("cd", 32), "", 1)); err == nil {
		t.Fatal("tuic sans empreinte accepté")
	}
	if _, err := newTUICClient(strings.Replace(ok, "11111111-2222-3333-4444-555555555555", "pas-un-uuid", 1)); err == nil {
		t.Fatal("tuic avec UUID invalide accepté")
	}
	for addr, want := range map[string][]byte{
		"1.2.3.4:80":      {0x01, 1, 2, 3, 4, 0, 80},
		"example.com:443": append(append([]byte{0x00, 11}, "example.com"...), 1, 187),
	} {
		got, err := tuicAddress(addr)
		if err != nil || string(got) != string(want) {
			t.Errorf("%s : %v %v", addr, got, err)
		}
	}
}

func TestSSHProfilesAreRefusedWhenUnverifiable(t *testing.T) {
	if _, err := newSSHClient("ssh", nil); err == nil {
		t.Fatal("profil absent accepté")
	}
	if _, err := newSSHClient("ssh", map[string]any{"host": "h", "port": 22.0, "username": "u", "private_key_openssh": "x"}); err == nil {
		t.Fatal("clé privée illisible acceptée")
	}
	if _, err := newSSHClient("shssl", map[string]any{"auth": "backend"}); err == nil {
		t.Fatal("SSH-SSL en relais accepté")
	}
}

func TestEnginesAndUnsupported(t *testing.T) {
	if !strings.Contains(Engines(), "xray") || strings.Contains(Engines(), "dnstt") || strings.Contains(Engines(), "udp") {
		t.Fatalf("moteurs annoncés : %s", Engines())
	}
	if _, err := buildOutbound(clientConfig{Engine: "dnstt"}); err == nil {
		t.Fatal("moteur sans adaptateur accepté")
	}
	if _, err := parseClientConfig(`{"uri":"x"}`); err == nil {
		t.Fatal("configuration sans moteur acceptée")
	}
}

// La configuration Xray d'un moteur TCP seul envoie le DNS en TCP par le tunnel et bloque le reste de l'UDP.
func TestTCPOnlyEnginesRouteDNSOverTheTunnel(t *testing.T) {
	cfg := xrayConfig(map[string]any{"tag": inboundTag}, outbound{config: map[string]any{"protocol": "socks"}, tcpOnly: true})
	raw, _ := json.Marshal(cfg)
	s := string(raw)
	for _, want := range []string{`"tcp://1.1.1.1"`, `"outboundTag":"dns-out"`, `"outboundTag":"block"`, `"inboundTag":["dns-query"]`} {
		if !strings.Contains(s, want) {
			t.Errorf("%s absent de %s", want, s)
		}
	}
	plain, _ := json.Marshal(xrayConfig(map[string]any{"tag": inboundTag}, outbound{config: map[string]any{"protocol": "vless"}}))
	if strings.Contains(string(plain), "dns-query") {
		t.Error("moteur avec UDP : le DNS doit suivre le tunnel normalement")
	}
}

// Le serveur SOCKS local relaie réellement vers l'adaptateur (ici une connexion directe).
func TestLocalSocksRelays(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		_, _ = c.Write([]byte("BANNIERE\n"))
		_, _ = io.Copy(c, c)
	}()
	srv, err := listenSocks(func(ctx context.Context, a string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", a)
	})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	conn := socksConnect(t, srv.port(), ln.Addr().(*net.TCPAddr).Port)
	defer conn.Close()
	r := bufio.NewReader(conn)
	if l, err := r.ReadString('\n'); err != nil || l != "BANNIERE\n" {
		t.Fatalf("bannière : %q %v", l, err)
	}
	_, _ = conn.Write([]byte("ping\n"))
	if l, err := r.ReadString('\n'); err != nil || l != "ping\n" {
		t.Fatalf("écho : %q %v", l, err)
	}
}

// socksConnect : client SOCKS5 minimal vers 127.0.0.1:target.
func socksConnect(t *testing.T, socksPort, target int) net.Conn {
	t.Helper()
	c, err := net.DialTimeout("tcp", joinHostPort("127.0.0.1", socksPort), 3*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_ = c.SetDeadline(time.Now().Add(20 * time.Second))
	_, _ = c.Write([]byte{5, 1, 0})
	b := make([]byte, 2)
	if _, err := io.ReadFull(c, b); err != nil || b[1] != 0 {
		t.Fatalf("socks méthode : %v %v", b, err)
	}
	_, _ = c.Write([]byte{5, 1, 0, 1, 127, 0, 0, 1, byte(target >> 8), byte(target)})
	rep := make([]byte, 10)
	if _, err := io.ReadFull(c, rep); err != nil || rep[1] != 0 {
		t.Fatalf("socks CONNECT : %v %v", rep, err)
	}
	return c
}

// Une configuration inutilisable est signalée comme telle (l'application affiche « configuration invalide »).
func TestConfigErrorsAreLabelled(t *testing.T) {
	for _, raw := range []string{`{"uri":"x"}`, `{"proto":"tuic","uri":"tuic://pas-un-uuid:pw@h:1"}`, `{"proto":"dnstt","uri":"dnstt://u@h"}`} {
		err := start(raw, map[string]any{"tag": inboundTag, "protocol": "socks", "listen": "127.0.0.1", "port": 0})
		if err == nil || !strings.HasPrefix(err.Error(), ErrInvalidConfig) {
			t.Errorf("%s : %v", raw, err)
		}
	}
}
