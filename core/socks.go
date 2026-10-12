package labocore

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"strconv"
	"sync"
	"time"
)

// dialFunc ouvre une connexion TCP vers « hôte:port » à travers un adaptateur (TUIC, SSH).
type dialFunc func(ctx context.Context, address string) (net.Conn, error)

// socksServer : serveur SOCKS5 minimal (sans authentification, commande CONNECT seulement) sur la
// boucle locale. Il n'est joint que par Xray, dans le même processus ; il n'écoute jamais ailleurs.
type socksServer struct {
	ln   net.Listener
	dial dialFunc
	wg   sync.WaitGroup
}

func listenSocks(dial dialFunc) (*socksServer, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	s := &socksServer{ln: ln, dial: dial}
	s.wg.Add(1)
	go s.serve()
	return s, nil
}

func (s *socksServer) port() int { return s.ln.Addr().(*net.TCPAddr).Port }

func (s *socksServer) Close() error {
	err := s.ln.Close()
	s.wg.Wait()
	return err
}

func (s *socksServer) serve() {
	defer s.wg.Done()
	for {
		c, err := s.ln.Accept()
		if err != nil {
			return
		}
		go s.handle(c)
	}
}

func (s *socksServer) handle(c net.Conn) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(20 * time.Second))
	target, err := socksHandshake(c)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	remote, err := s.dial(ctx, target)
	cancel()
	if err != nil {
		_, _ = c.Write([]byte{5, 5, 0, 1, 0, 0, 0, 0, 0, 0}) // connexion refusée
		return
	}
	defer remote.Close()
	if _, err := c.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}); err != nil {
		return
	}
	_ = c.SetDeadline(time.Time{})
	relay(c, remote)
}

// socksHandshake lit la négociation SOCKS5 et retourne la destination « hôte:port » demandée.
func socksHandshake(c net.Conn) (string, error) {
	head := make([]byte, 2)
	if _, err := io.ReadFull(c, head); err != nil || head[0] != 5 {
		return "", errors.New("pas une négociation SOCKS5")
	}
	methods := make([]byte, head[1])
	if _, err := io.ReadFull(c, methods); err != nil {
		return "", err
	}
	if _, err := c.Write([]byte{5, 0}); err != nil {
		return "", err
	}
	req := make([]byte, 4)
	if _, err := io.ReadFull(c, req); err != nil || req[0] != 5 {
		return "", errors.New("requête SOCKS5 invalide")
	}
	if req[1] != 1 { // seul CONNECT
		_, _ = c.Write([]byte{5, 7, 0, 1, 0, 0, 0, 0, 0, 0})
		return "", errors.New("commande SOCKS5 non prise en charge")
	}
	var host string
	switch req[3] {
	case 1:
		b := make([]byte, 4)
		if _, err := io.ReadFull(c, b); err != nil {
			return "", err
		}
		host = net.IP(b).String()
	case 4:
		b := make([]byte, 16)
		if _, err := io.ReadFull(c, b); err != nil {
			return "", err
		}
		host = net.IP(b).String()
	case 3:
		l := make([]byte, 1)
		if _, err := io.ReadFull(c, l); err != nil {
			return "", err
		}
		b := make([]byte, l[0])
		if _, err := io.ReadFull(c, b); err != nil {
			return "", err
		}
		host = string(b)
	default:
		return "", errors.New("type d'adresse SOCKS5 inconnu")
	}
	p := make([]byte, 2)
	if _, err := io.ReadFull(c, p); err != nil {
		return "", err
	}
	return net.JoinHostPort(host, strconv.Itoa(int(binary.BigEndian.Uint16(p)))), nil
}

// relay copie dans les deux sens ; quand un sens se termine, l'autre a 30 s pour se vider.
func relay(a, b net.Conn) {
	done := make(chan struct{}, 2)
	cp := func(dst, src net.Conn) {
		_, _ = io.Copy(dst, src)
		if cw, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		}
		done <- struct{}{}
	}
	go cp(a, b)
	go cp(b, a)
	<-done
	select {
	case <-done:
	case <-time.After(30 * time.Second):
	}
}
