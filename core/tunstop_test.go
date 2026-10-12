package labocore

import (
	"reflect"
	"testing"

	"github.com/xtls/xray-core/proxy/tun"
)

// Garde-fou de montée de version d'Xray : closeTunStack dépend du champ non exporté tun.Handler.stack.
func TestTunHandlerKeepsItsStackField(t *testing.T) {
	f, ok := reflect.TypeOf(tun.Handler{}).FieldByName("stack")
	if !ok || f.Type != reflect.TypeOf((*tun.Stack)(nil)).Elem() {
		t.Fatal("tun.Handler.stack absent ou de type différent : revoir closeTunStack (arrêt du VPN)")
	}
	if tunStackOf(&tun.Handler{}) != nil {
		t.Fatal("pile vide attendue")
	}
}

type fakeStack struct{ closed bool }

func (s *fakeStack) Start() error { return nil }
func (s *fakeStack) Close() error { s.closed = true; return nil }

func TestTunStackOfReadsTheRealField(t *testing.T) {
	h := &tun.Handler{}
	fs := &fakeStack{}
	f := reflect.ValueOf(h).Elem().FieldByName("stack")
	reflect.NewAt(f.Type(), unsafePointer(f)).Elem().Set(reflect.ValueOf(tun.Stack(fs)))
	s := tunStackOf(h)
	if s == nil {
		t.Fatal("pile non lue")
	}
	_ = s.Close()
	if !fs.closed {
		t.Fatal("Close n'a pas atteint la pile")
	}
}
