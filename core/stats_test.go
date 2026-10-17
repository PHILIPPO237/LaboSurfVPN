package labocore

// Statistiques de trafic : choix de la source de mesure (jamais deux sources additionnées) et chemin RÉEL de
// l'entrée TUN d'Xray. Ce dernier reproduit l'appel de proxy/tun/handler.go (HandleConnection) :
// session.Inbound{Tag: "tun"} puis dispatcher.DispatchLink, sans « worker » d'écoute. L'interface TUN
// elle-même est impossible hors Android / Linux root : la navigation réelle reste à valider sur téléphone.

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/xtls/xray-core/common/buf"
	xnet "github.com/xtls/xray-core/common/net"
	"github.com/xtls/xray-core/common/session"
	"github.com/xtls/xray-core/features/routing"
	"github.com/xtls/xray-core/features/stats"
	"github.com/xtls/xray-core/transport"
	"golang.org/x/crypto/ssh"
)

type fakeCounter int64

func (c fakeCounter) Value() int64    { return int64(c) }
func (c fakeCounter) Set(int64) int64 { return int64(c) }
func (c fakeCounter) Add(int64) int64 { return int64(c) }

type fakeSource map[string]int64

func (f fakeSource) GetCounter(name string) stats.Counter {
	if v, ok := f[name]; ok {
		return fakeCounter(v)
	}
	return nil
}

const (
	inUp   = "inbound>>>tun>>>traffic>>>uplink"
	inDown = "inbound>>>tun>>>traffic>>>downlink"
	obUp   = "outbound>>>proxy>>>traffic>>>uplink"
	obDown = "outbound>>>proxy>>>traffic>>>downlink"
)

func TestTrafficCountersChoice(t *testing.T) {
	cases := []struct {
		name   string
		src    fakeSource
		rx, tx int64
		ok     bool
	}{
		{"entrée non nulle : conservée, la sortie n'est PAS ajoutée", fakeSource{inUp: 10, inDown: 20, obUp: 11, obDown: 22}, 20, 10, true},
		{"entrée à zéro (TUN) : repli sur la sortie", fakeSource{inUp: 0, inDown: 0, obUp: 5, obDown: 7}, 7, 5, true},
		{"entrée absente : sortie", fakeSource{obUp: 5, obDown: 7}, 7, 5, true},
		{"tout à zéro : zéro réel (compteurs présents)", fakeSource{inUp: 0, inDown: 0, obUp: 0, obDown: 0}, 0, 0, true},
		{"seule l'entrée existe, à zéro : zéro réel", fakeSource{inUp: 0, inDown: 0}, 0, 0, true},
		{"aucun compteur : indisponible, pas 0", fakeSource{}, 0, 0, false},
		{"compteurs incomplets : indisponible", fakeSource{obUp: 3}, 0, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rx, tx, ok := trafficCounters(c.src)
			if rx != c.rx || tx != c.tx || ok != c.ok {
				t.Fatalf("obtenu rx=%d tx=%d ok=%v, attendu rx=%d tx=%d ok=%v", rx, tx, ok, c.rx, c.tx, c.ok)
			}
		})
	}
}

// viaTunDispatch ouvre une connexion TCP vers 127.0.0.1:port comme le fait l'entrée TUN d'Xray.
func viaTunDispatch(t *testing.T, port int) net.Conn {
	t.Helper()
	mu.Lock()
	inst := instance
	mu.Unlock()
	d, ok := inst.GetFeature(routing.DispatcherType()).(routing.Dispatcher)
	if !ok {
		t.Fatal("pas de répartiteur")
	}
	a, b := net.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	ctx = session.ContextWithInbound(ctx, &session.Inbound{Name: "tun", Tag: inboundTag,
		Source: xnet.TCPDestination(xnet.ParseAddress("10.0.0.2"), 40000)})
	link := &transport.Link{Reader: buf.NewReader(b), Writer: buf.NewWriter(b)}
	go func() {
		defer b.Close()
		_ = d.DispatchLink(ctx, xnet.TCPDestination(xnet.ParseAddress("127.0.0.1"), xnet.Port(port)), link)
	}()
	return a
}

// TestStatsOnTunDispatchPath : trafic injecté par le chemin de l'entrée TUN (SSH) ; Stats() doit le mesurer
// (compteurs de sortie) et le compter UNE seule fois.
func TestStatsOnTunDispatchPath(t *testing.T) {
	_, _, _, cert := testCert(t)
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(priv)
	port, hostKey := sshTestServer(t, "ssh", signer.PublicKey(), cert)
	block, _ := ssh.MarshalPrivateKey(priv, "fs-u1@labosurf")
	profile := map[string]any{"type": "ssh", "host": "127.0.0.1", "port": float64(port), "username": "fs-u1", "auth": "publickey",
		"private_key_openssh": string(pem.EncodeToMemory(block)),
		"host_key":            strings.TrimSpace(string(ssh.MarshalAuthorizedKey(hostKey)))}
	target := localEcho(t, "LABOSURF-TUNPATH")
	// entrée « inutilisée » : aucun worker ne mesure l'entrée « tun », comme avec l'entrée TUN réelle
	if err := start(cfgJSON("ssh", "", profile), map[string]any{"tag": "idle", "protocol": "socks", "listen": "127.0.0.1",
		"port": freePort(t, "tcp"), "settings": map[string]any{"auth": "noauth"}}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(Stop)

	read := func() (rx, tx int64, ok bool) {
		var st struct {
			Rx, Tx  *int64
			Running bool
		}
		_ = json.Unmarshal([]byte(Stats()), &st)
		if st.Rx == nil || st.Tx == nil {
			return 0, 0, false
		}
		return *st.Rx, *st.Tx, true
	}
	if rx, tx, ok := read(); !ok || rx != 0 || tx != 0 {
		t.Fatalf("avant tout trafic : attendu 0/0 mesuré, obtenu %d/%d ok=%v (%s)", rx, tx, ok, Stats())
	}

	c := viaTunDispatch(t, target)
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(15 * time.Second))
	r := bufio.NewReader(c)
	if l, err := r.ReadString('\n'); err != nil || strings.TrimSpace(l) != "LABOSURF-TUNPATH" {
		t.Fatalf("bannière non reçue par le chemin TUN : %q %v", l, err)
	}
	payload := strings.Repeat("x", 4000) + "\n"
	if _, err := c.Write([]byte(payload)); err != nil {
		t.Fatal(err)
	}
	if l, err := r.ReadString('\n'); err != nil || l != payload {
		t.Fatalf("écho non reçu : %v", err)
	}
	rx, tx, ok := read()
	if !ok || rx < int64(len(payload)) || tx < int64(len(payload)) {
		t.Fatalf("trafic non mesuré : %s", Stats())
	}
	// pas de double comptage : environ 1 fois la charge (plus bannière et petit en-tête), jamais 2 fois
	if rx > 2*int64(len(payload)) || tx > 2*int64(len(payload)) {
		t.Fatalf("trafic compté plusieurs fois : rx=%d tx=%d pour %d octets", rx, tx, len(payload))
	}
	t.Logf("✓ chemin d'entrée TUN : %s", Stats())
}
