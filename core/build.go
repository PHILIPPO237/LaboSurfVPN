package labocore

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// clientConfig : configuration reçue du Panel (POST /api/user/connect → config), transmise telle quelle
// par l'application. « proto » (ou « engine ») désigne le moteur ; « uri » est le lien émis par PRO ;
// « profile » le profil structuré (moteurs SSH).
type clientConfig struct {
	Engine  string         `json:"engine"`
	Proto   string         `json:"proto"`
	URI     string         `json:"uri"`
	Format  string         `json:"format"`
	Profile map[string]any `json:"profile"`
}

func parseClientConfig(raw string) (clientConfig, error) {
	var c clientConfig
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		return c, errors.New("configuration illisible")
	}
	if c.Engine == "" {
		c.Engine = c.Proto
	}
	c.Engine = strings.ToLower(strings.TrimSpace(c.Engine))
	if c.Engine == "" {
		return c, errors.New("moteur absent de la configuration")
	}
	return c, nil
}

// outbound : sortie Xray du moteur, et ressources locales à fermer avec la session.
type outbound struct {
	config  map[string]any
	tcpOnly bool
	closers []io.Closer
}

func buildOutbound(c clientConfig) (outbound, error) {
	switch c.Engine {
	case "xray", "vless":
		ob, err := vlessOutbound(c.URI)
		return outbound{config: ob}, err
	case "hysteria2":
		ob, err := hysteria2Outbound(c.URI)
		return outbound{config: ob}, err
	case "wireguard":
		ob, err := wireguardOutbound(c.URI)
		return outbound{config: ob}, err
	case "tuic":
		t, err := newTUICClient(c.URI)
		if err != nil {
			return outbound{}, err
		}
		return localSocksOutbound(t.dial, t)
	case "ssh", "shssl", "sshhttp":
		s, err := newSSHClient(c.Engine, c.Profile)
		if err != nil {
			return outbound{}, err
		}
		return localSocksOutbound(s.dial, s)
	}
	return outbound{}, fmt.Errorf("moteur « %s » non pris en charge par cette version de l'application", c.Engine)
}

// localSocksOutbound démarre un serveur SOCKS5 local (127.0.0.1) relié à l'adaptateur et retourne la
// sortie Xray qui le vise. Ces adaptateurs ne transportent que du TCP (voir xrayConfig).
func localSocksOutbound(dial dialFunc, adapter io.Closer) (outbound, error) {
	srv, err := listenSocks(dial)
	if err != nil {
		_ = adapter.Close()
		return outbound{}, err
	}
	return outbound{
		config: map[string]any{
			"protocol": "socks",
			"settings": map[string]any{"servers": []any{map[string]any{"address": "127.0.0.1", "port": srv.port()}}},
		},
		tcpOnly: true,
		closers: []io.Closer{srv, adapter},
	}, nil
}

// ------------------------------------------------------------------ VLESS (Xray)

func vlessOutbound(link string) (map[string]any, error) {
	u, err := url.Parse(strings.TrimSpace(link))
	if err != nil || u.Scheme != "vless" || u.User == nil || u.User.Username() == "" {
		return nil, errors.New("lien VLESS invalide")
	}
	host, port, err := hostPort(u)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	user := map[string]any{"id": u.User.Username(), "encryption": "none"}
	if f := q.Get("flow"); f != "" {
		user["flow"] = f
	}
	network := q.Get("type")
	if network == "" {
		network = "tcp"
	}
	security := q.Get("security")
	if security == "" {
		security = "none"
	}
	stream := map[string]any{"network": network, "security": security}
	switch security {
	case "tls":
		if q.Get("sni") == "" {
			return nil, errors.New("lien VLESS TLS sans SNI")
		}
		tls := map[string]any{"serverName": q.Get("sni")}
		if fp := q.Get("fp"); fp != "" {
			tls["fingerprint"] = fp
		}
		if alpn := q.Get("alpn"); alpn != "" {
			tls["alpn"] = strings.Split(alpn, ",")
		}
		if pin := q.Get("pcs"); pin != "" {
			tls["pinnedPeerCertSha256"] = pin
		}
		stream["tlsSettings"] = tls
	case "reality":
		if q.Get("pbk") == "" || q.Get("sni") == "" {
			return nil, errors.New("lien REALITY incomplet (pbk, sni)")
		}
		fp := q.Get("fp")
		if fp == "" {
			fp = "chrome"
		}
		stream["realitySettings"] = map[string]any{
			"serverName": q.Get("sni"), "fingerprint": fp, "publicKey": q.Get("pbk"), "shortId": q.Get("sid"),
			"spiderX": q.Get("spx"),
		}
	case "none":
	default:
		return nil, fmt.Errorf("sécurité VLESS « %s » non prise en charge", security)
	}
	switch network {
	case "tcp", "raw":
	case "ws":
		stream["wsSettings"] = map[string]any{"path": orDefault(q.Get("path"), "/"), "host": q.Get("host")}
	case "xhttp", "splithttp":
		stream["network"] = "xhttp"
		stream["xhttpSettings"] = map[string]any{"path": orDefault(q.Get("path"), "/"), "host": q.Get("host"), "mode": orDefault(q.Get("mode"), "auto")}
	case "grpc":
		stream["grpcSettings"] = map[string]any{"serviceName": q.Get("serviceName"), "multiMode": q.Get("mode") == "multi"}
	default:
		return nil, fmt.Errorf("transport VLESS « %s » non pris en charge", network)
	}
	return map[string]any{
		"protocol":       "vless",
		"settings":       map[string]any{"vnext": []any{map[string]any{"address": host, "port": port, "users": []any{user}}}},
		"streamSettings": stream,
	}, nil
}

// ------------------------------------------------------------------ Hysteria2 (Xray)

func hysteria2Outbound(link string) (map[string]any, error) {
	u, err := url.Parse(strings.TrimSpace(link))
	if err != nil || (u.Scheme != "hysteria2" && u.Scheme != "hy2") || u.User == nil {
		return nil, errors.New("lien Hysteria2 invalide")
	}
	host, port, err := hostPort(u)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	auth := u.User.Username()
	if pw, ok := u.User.Password(); ok {
		auth = auth + ":" + pw // authentification « userpass » du serveur
	}
	pin := q.Get("pinSHA256")
	if pin == "" {
		// Certificat auto-signé : sans empreinte, il ne peut pas être vérifié (Xray refuse
		// « allowInsecure ») — jamais d'acceptation aveugle.
		return nil, errors.New("certificat du serveur Hysteria2 non vérifiable : empreinte absente du lien (mettre à jour LABOSURF PRO)")
	}
	tls := map[string]any{"serverName": orDefault(q.Get("sni"), host), "alpn": []string{"h3"}, "pinnedPeerCertSha256": pin}
	stream := map[string]any{
		"network":          "hysteria",
		"security":         "tls",
		"tlsSettings":      tls,
		"hysteriaSettings": map[string]any{"version": 2, "auth": auth},
	}
	switch q.Get("obfs") {
	case "":
	case "salamander":
		if q.Get("obfs-password") == "" {
			return nil, errors.New("lien Hysteria2 : mot de passe d'obfuscation absent")
		}
		stream["finalmask"] = map[string]any{"udp": []any{map[string]any{
			"type": "salamander", "settings": map[string]any{"password": q.Get("obfs-password")},
		}}}
	default:
		return nil, fmt.Errorf("obfuscation Hysteria2 « %s » non prise en charge", q.Get("obfs"))
	}
	return map[string]any{
		"protocol":       "hysteria",
		"settings":       map[string]any{"version": 2, "address": host, "port": port},
		"streamSettings": stream,
	}, nil
}

// ------------------------------------------------------------------ WireGuard (Xray)

// wireguardOutbound lit le fichier wg-quick émis par PRO ([Interface] + [Peer]).
func wireguardOutbound(conf string) (map[string]any, error) {
	sec := ""
	iface, peer := map[string]string{}, map[string]string{}
	sc := bufio.NewScanner(strings.NewReader(conf))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") {
			sec = strings.ToLower(strings.Trim(line, "[]"))
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k, v = strings.ToLower(strings.TrimSpace(k)), strings.TrimSpace(v)
		switch sec {
		case "interface":
			iface[k] = v
		case "peer":
			peer[k] = v
		}
	}
	for _, need := range [][2]string{{iface["privatekey"], "PrivateKey"}, {iface["address"], "Address"},
		{peer["publickey"], "PublicKey"}, {peer["endpoint"], "Endpoint"}} {
		if need[0] == "" {
			return nil, fmt.Errorf("configuration WireGuard incomplète : %s absent", need[1])
		}
	}
	allowed := []string{"0.0.0.0/0", "::/0"}
	if a := peer["allowedips"]; a != "" {
		allowed = splitList(a)
	}
	keep := 25
	if k, err := strconv.Atoi(peer["persistentkeepalive"]); err == nil && k > 0 {
		keep = k
	}
	return map[string]any{
		"protocol": "wireguard",
		"settings": map[string]any{
			"secretKey":   iface["privatekey"],
			"address":     splitList(iface["address"]),
			"peers":       []any{map[string]any{"publicKey": peer["publickey"], "endpoint": peer["endpoint"], "allowedIPs": allowed, "keepAlive": keep}},
			"mtu":         1280,
			"noKernelTun": true,
		},
	}, nil
}

// ------------------------------------------------------------------ utilitaires

func hostPort(u *url.URL) (string, int, error) {
	host := u.Hostname()
	p, err := strconv.Atoi(u.Port())
	if host == "" || err != nil || p < 1 || p > 65535 {
		return "", 0, errors.New("hôte ou port du serveur invalide dans le lien")
	}
	return host, p, nil
}

func orDefault(v, d string) string {
	if v == "" {
		return d
	}
	return v
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// joinHostPort : adresse « hôte:port » (IPv6 entre crochets).
func joinHostPort(host string, port int) string { return net.JoinHostPort(host, strconv.Itoa(port)) }
