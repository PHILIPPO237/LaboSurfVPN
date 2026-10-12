package labocore

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// Adaptateur SSH (moteurs ssh, shssl, sshhttp) : connexion SSH authentifiée par la clé de l'Access
// (profil émis par PRO), puis une redirection « direct-tcpip » par connexion de l'abonné. Transport :
//
//	ssh      TCP direct
//	shssl    TLS dont le certificat est vérifié par son empreinte (tls_cert_sha256), puis SSH
//	sshhttp  requête HTTP EXACTE fournie par le Panel (http_payload), réponse de succès, puis SSH
//
// La clé du serveur SSH est TOUJOURS vérifiée (host_key du profil) : jamais d'acceptation aveugle.

type sshClient struct {
	engine  string
	addr    string
	cfg     *ssh.ClientConfig
	tlsConf *tls.Config // shssl
	payload string      // sshhttp
	status  int         // sshhttp : code de succès attendu

	mu     sync.Mutex
	client *ssh.Client
	closed bool
	stop   chan struct{}
}

func profileString(p map[string]any, key string) string {
	if v, ok := p[key]; ok && v != nil {
		switch x := v.(type) {
		case string:
			return strings.TrimSpace(x)
		case float64:
			return strconv.FormatFloat(x, 'f', -1, 64)
		}
	}
	return ""
}

func newSSHClient(engine string, p map[string]any) (*sshClient, error) {
	if len(p) == 0 {
		return nil, errors.New("profil SSH absent de la configuration (mettre à jour le Panel)")
	}
	if profileString(p, "auth") == "backend" {
		return nil, errors.New("ce Service SSH-SSL relaie un serveur SSH existant : non pris en charge par l'application")
	}
	host, user := profileString(p, "host"), profileString(p, "username")
	port, err := strconv.Atoi(profileString(p, "port"))
	if host == "" || user == "" || err != nil || port < 1 || port > 65535 {
		return nil, errors.New("profil SSH incomplet (hôte, port, utilisateur)")
	}
	key := profileString(p, "private_key_openssh")
	if key == "" {
		return nil, errors.New("profil SSH sans clé privée")
	}
	signer, err := ssh.ParsePrivateKey([]byte(key))
	if err != nil {
		return nil, errors.New("clé privée SSH illisible")
	}
	hk := profileString(p, "host_key")
	if hk == "" {
		return nil, errors.New("profil SSH sans clé du serveur : connexion non vérifiable")
	}
	hostKey, _, _, _, err := ssh.ParseAuthorizedKey([]byte(hk))
	if err != nil {
		return nil, errors.New("clé du serveur SSH illisible")
	}
	c := &sshClient{
		engine: engine, addr: joinHostPort(host, port), stop: make(chan struct{}),
		cfg: &ssh.ClientConfig{
			User: user, Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)},
			HostKeyCallback: ssh.FixedHostKey(hostKey), Timeout: 15 * time.Second,
		},
	}
	switch engine {
	case "shssl":
		pin, err := hex.DecodeString(strings.ReplaceAll(profileString(p, "tls_cert_sha256"), ":", ""))
		if err != nil || len(pin) != 32 {
			return nil, errors.New("profil SSH-SSL sans empreinte du certificat : connexion non vérifiable")
		}
		c.tlsConf = &tls.Config{
			ServerName: orDefault(profileString(p, "sni"), host), MinVersion: tls.VersionTLS12,
			InsecureSkipVerify: true, VerifyPeerCertificate: pinVerifier(pin),
		}
	case "sshhttp":
		// payload EXACT (jamais nettoyé : il se termine par la ligne vide CRLF CRLF de la requête)
		c.payload, _ = p["http_payload"].(string)
		if c.payload == "" || !strings.HasSuffix(c.payload, "\r\n\r\n") {
			return nil, errors.New("profil SSH-HTTP sans requête HTTP valide")
		}
		c.status = 200
		if profileString(p, "transport") == "get-upgrade" {
			c.status = 101
		}
	}
	return c, nil
}

// transport ouvre la connexion porteuse du SSH selon le moteur.
func (c *sshClient) transport(ctx context.Context) (net.Conn, error) {
	d := net.Dialer{Timeout: 15 * time.Second}
	raw, err := d.DialContext(ctx, "tcp", c.addr)
	if err != nil {
		return nil, err
	}
	switch c.engine {
	case "shssl":
		tc := tls.Client(raw, c.tlsConf)
		_ = tc.SetDeadline(time.Now().Add(15 * time.Second))
		if err := tc.HandshakeContext(ctx); err != nil {
			raw.Close()
			return nil, fmt.Errorf("TLS : %w", err)
		}
		_ = tc.SetDeadline(time.Time{})
		return tc, nil
	case "sshhttp":
		_ = raw.SetDeadline(time.Now().Add(15 * time.Second))
		if _, err := io.WriteString(raw, c.payload); err != nil {
			raw.Close()
			return nil, err
		}
		br := bufio.NewReader(raw)
		status, err := readHTTPStatus(br)
		if err != nil || status != c.status {
			raw.Close()
			if err == nil {
				err = fmt.Errorf("le serveur a répondu %d au lieu de %d", status, c.status)
			}
			return nil, fmt.Errorf("requête HTTP : %w", err)
		}
		_ = raw.SetDeadline(time.Time{})
		return &bufferedConn{Conn: raw, r: br}, nil
	}
	return raw, nil
}

// readHTTPStatus lit la ligne d'état et les en-têtes (jusqu'à la ligne vide) ; les octets suivants
// (début du flux SSH) restent dans le tampon.
func readHTTPStatus(br *bufio.Reader) (int, error) {
	line, err := br.ReadString('\n')
	if err != nil {
		return 0, err
	}
	f := strings.Fields(line)
	if len(f) < 2 || !strings.HasPrefix(f[0], "HTTP/1.") {
		return 0, errors.New("réponse HTTP invalide")
	}
	code, err := strconv.Atoi(f[1])
	if err != nil {
		return 0, errors.New("code HTTP invalide")
	}
	for i := 0; i < 64; i++ {
		l, err := br.ReadString('\n')
		if err != nil {
			return 0, err
		}
		if strings.TrimRight(l, "\r\n") == "" {
			return code, nil
		}
	}
	return 0, errors.New("en-têtes HTTP trop longs")
}

type bufferedConn struct {
	net.Conn
	r *bufio.Reader
}

func (b *bufferedConn) Read(p []byte) (int, error) { return b.r.Read(p) }

// session retourne le client SSH connecté (rétabli s'il est tombé).
func (c *sshClient) session(ctx context.Context) (*ssh.Client, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, errors.New("client SSH arrêté")
	}
	if c.client != nil {
		if _, _, err := c.client.SendRequest("keepalive@openssh.com", true, nil); err == nil {
			return c.client, nil
		}
		_ = c.client.Close()
		c.client = nil
	}
	conn, err := c.transport(ctx)
	if err != nil {
		return nil, fmt.Errorf("connexion %s : %w", c.engine, err)
	}
	sc, chans, reqs, err := ssh.NewClientConn(conn, c.addr, c.cfg)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("authentification SSH : %w", err)
	}
	c.client = ssh.NewClient(sc, chans, reqs)
	go c.keepalive(c.client)
	return c.client, nil
}

func (c *sshClient) keepalive(cl *ssh.Client) {
	tk := time.NewTicker(20 * time.Second)
	defer tk.Stop()
	for {
		select {
		case <-tk.C:
			if _, _, err := cl.SendRequest("keepalive@openssh.com", true, nil); err != nil {
				return
			}
		case <-c.stop:
			return
		}
	}
}

// dial ouvre une redirection « direct-tcpip » vers address.
func (c *sshClient) dial(ctx context.Context, address string) (net.Conn, error) {
	cl, err := c.session(ctx)
	if err != nil {
		return nil, err
	}
	return cl.DialContext(ctx, "tcp", address)
}

func (c *sshClient) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.stop)
	}
	if c.client != nil {
		_ = c.client.Close()
		c.client = nil
	}
	return nil
}
