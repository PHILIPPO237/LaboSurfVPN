package labocore

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/quic-go/quic-go"
)

// Client TUIC v5 (protocole : github.com/EAimTY/tuic/blob/dev/SPEC.md) : TCP seulement (commande
// CONNECT), authentification par jeton exporté de la session TLS, battement de cœur par datagramme.
// Le certificat auto-signé du serveur est vérifié par son empreinte SHA-256 (pin_sha256 du lien).

const (
	tuicVersion      = 0x05
	tuicCmdAuth      = 0x00
	tuicCmdConnect   = 0x01
	tuicCmdHeartbeat = 0x04
)

type tuicClient struct {
	addr     string
	tls      *tls.Config
	uuid     [16]byte
	password string

	mu     sync.Mutex
	conn   *quic.Conn
	closed bool
	stop   chan struct{}
}

func newTUICClient(link string) (*tuicClient, error) {
	u, err := url.Parse(strings.TrimSpace(link))
	if err != nil || u.Scheme != "tuic" || u.User == nil {
		return nil, errors.New("lien TUIC invalide")
	}
	host, port, err := hostPort(u)
	if err != nil {
		return nil, err
	}
	id, err := parseUUID(u.User.Username())
	if err != nil {
		return nil, errors.New("lien TUIC : identifiant (UUID) invalide")
	}
	pw, _ := u.User.Password()
	if pw == "" {
		return nil, errors.New("lien TUIC : mot de passe absent")
	}
	q := u.Query()
	pin, err := hex.DecodeString(strings.ReplaceAll(q.Get("pin_sha256"), ":", ""))
	if err != nil || len(pin) != sha256.Size {
		return nil, errors.New("certificat du serveur TUIC non vérifiable : empreinte absente du lien (mettre à jour LABOSURF PRO)")
	}
	alpn := splitList(orDefault(q.Get("alpn"), "h3"))
	tc := &tls.Config{
		ServerName: orDefault(q.Get("sni"), host),
		NextProtos: alpn,
		MinVersion: tls.VersionTLS13,
		// Certificat auto-signé : la chaîne n'est pas vérifiable par une autorité, l'EMPREINTE l'est.
		InsecureSkipVerify:    true,
		VerifyPeerCertificate: pinVerifier(pin),
	}
	return &tuicClient{addr: joinHostPort(host, port), tls: tc, uuid: id, password: pw, stop: make(chan struct{})}, nil
}

// pinVerifier accepte uniquement le certificat dont le SHA-256 (DER) vaut pin.
func pinVerifier(pin []byte) func([][]byte, [][]*x509.Certificate) error {
	return func(raw [][]byte, _ [][]*x509.Certificate) error {
		if len(raw) == 0 {
			return errors.New("aucun certificat présenté")
		}
		sum := sha256.Sum256(raw[0])
		if string(sum[:]) != string(pin) {
			return errors.New("certificat du serveur différent de l'empreinte attendue")
		}
		return nil
	}
}

// connection retourne la connexion QUIC authentifiée (rétablie si elle est tombée).
func (t *tuicClient) connection(ctx context.Context) (*quic.Conn, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return nil, errors.New("client TUIC arrêté")
	}
	if t.conn != nil && t.conn.Context().Err() == nil {
		return t.conn, nil
	}
	conn, err := quic.DialAddr(ctx, t.addr, t.tls, &quic.Config{
		EnableDatagrams: true, KeepAlivePeriod: 10 * time.Second, MaxIdleTimeout: 30 * time.Second,
		HandshakeIdleTimeout: 10 * time.Second,
	})
	if err != nil {
		return nil, fmt.Errorf("connexion TUIC : %w", err)
	}
	if err := t.authenticate(ctx, conn); err != nil {
		_ = conn.CloseWithError(0, "")
		return nil, err
	}
	t.conn = conn
	go t.heartbeat(conn)
	return conn, nil
}

// authenticate : flux unidirectionnel VER CMD UUID(16) TOKEN(32), TOKEN = exportateur TLS
// (étiquette = UUID, contexte = mot de passe), comme l'exige le serveur.
func (t *tuicClient) authenticate(ctx context.Context, conn *quic.Conn) error {
	st := conn.ConnectionState().TLS
	token, err := st.ExportKeyingMaterial(string(t.uuid[:]), []byte(t.password), 32)
	if err != nil {
		return fmt.Errorf("jeton TUIC : %w", err)
	}
	s, err := conn.OpenUniStreamSync(ctx)
	if err != nil {
		return fmt.Errorf("authentification TUIC : %w", err)
	}
	msg := append([]byte{tuicVersion, tuicCmdAuth}, t.uuid[:]...)
	msg = append(msg, token...)
	if _, err := s.Write(msg); err != nil {
		return fmt.Errorf("authentification TUIC : %w", err)
	}
	return s.Close()
}

func (t *tuicClient) heartbeat(conn *quic.Conn) {
	tk := time.NewTicker(10 * time.Second)
	defer tk.Stop()
	for {
		select {
		case <-tk.C:
			if conn.SendDatagram([]byte{tuicVersion, tuicCmdHeartbeat}) != nil {
				return
			}
		case <-conn.Context().Done():
			return
		case <-t.stop:
			return
		}
	}
}

// dial ouvre une connexion TCP vers address par la commande CONNECT.
func (t *tuicClient) dial(ctx context.Context, address string) (net.Conn, error) {
	header, err := tuicAddress(address)
	if err != nil {
		return nil, err
	}
	conn, err := t.connection(ctx)
	if err != nil {
		return nil, err
	}
	s, err := conn.OpenStreamSync(ctx)
	if err != nil {
		return nil, fmt.Errorf("flux TUIC : %w", err)
	}
	if _, err := s.Write(append([]byte{tuicVersion, tuicCmdConnect}, header...)); err != nil {
		s.CancelRead(0)
		_ = s.Close()
		return nil, err
	}
	return &tuicStream{Stream: s, local: conn.LocalAddr(), remote: conn.RemoteAddr()}, nil
}

func (t *tuicClient) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.closed {
		t.closed = true
		close(t.stop)
	}
	if t.conn != nil {
		_ = t.conn.CloseWithError(0, "")
		t.conn = nil
	}
	return nil
}

// tuicAddress encode ADDRESS (TYPE, adresse, PORT) : 0x00 domaine, 0x01 IPv4, 0x02 IPv6.
func tuicAddress(address string) ([]byte, error) {
	host, ps, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	port, err := strconv.Atoi(ps)
	if err != nil || port < 1 || port > 65535 {
		return nil, errors.New("port invalide")
	}
	var b []byte
	if ip := net.ParseIP(host); ip != nil {
		if v4 := ip.To4(); v4 != nil {
			b = append([]byte{0x01}, v4...)
		} else {
			b = append([]byte{0x02}, ip.To16()...)
		}
	} else {
		if len(host) == 0 || len(host) > 255 {
			return nil, errors.New("nom d'hôte invalide")
		}
		b = append([]byte{0x00, byte(len(host))}, host...)
	}
	return binary.BigEndian.AppendUint16(b, uint16(port)), nil
}

// tuicStream : flux QUIC présenté comme une connexion TCP.
type tuicStream struct {
	*quic.Stream
	local, remote net.Addr
}

func (s *tuicStream) LocalAddr() net.Addr  { return s.local }
func (s *tuicStream) RemoteAddr() net.Addr { return s.remote }

// CloseWrite termine l'envoi (FIN) en gardant la lecture ouverte.
func (s *tuicStream) CloseWrite() error { return s.Stream.Close() }

// Close ferme les deux sens.
func (s *tuicStream) Close() error {
	s.Stream.CancelRead(0)
	return s.Stream.Close()
}

func parseUUID(s string) ([16]byte, error) {
	var id [16]byte
	h := strings.ReplaceAll(strings.TrimSpace(s), "-", "")
	b, err := hex.DecodeString(h)
	if err != nil || len(b) != 16 {
		return id, errors.New("UUID invalide")
	}
	copy(id[:], b)
	return id, nil
}
