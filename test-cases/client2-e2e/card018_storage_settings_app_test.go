//go:build server

package desktop

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"respire-client2/internal/host"
)

var card018StorageSettingsSource string

func TestCard018OwnedStorageSettings(t *testing.T) {
	if card018StorageSettingsSource != "505ecc4d3a4f6c67c6a35751ed3c467a337027e9" ||
		os.Getenv("CARD018_SOURCE") != card018StorageSettingsSource ||
		os.Getenv("GITHUB_ACTIONS") != "true" || os.Getenv("RUNNER_ENVIRONMENT") != "github-hosted" {
		t.Fatal("isolated storage settings hosted source guard")
	}
	if os.Getenv("CARD018_STORAGE_SETTINGS_ONLY") != "1" {
		t.Fatal("cannot mount storage settings without native preflight")
	}
	locale, endpoint := os.Getenv("CARD018_LOCALE"), os.Getenv("CARD018_RUNTIME_URL")
	if (locale != "en" && locale != "zh") || !strings.HasPrefix(endpoint, "http://127.0.0.1:") {
		t.Fatal("invalid isolated configuration")
	}
	t.Setenv("RSRS_RPC_PORT", strings.TrimPrefix(endpoint, "http://127.0.0.1:"))
	t.Setenv("FRONTEND_DEVSERVER_URL", "")
	t.Setenv("WAILS_SERVER_HOST", "127.0.0.1")
	t.Setenv("WAILS_SERVER_PORT", "")
	root := os.Getenv("CARD018_RUNTIME_DATA")
	if root == "" || !filepath.IsAbs(root) {
		t.Fatal("expected isolated Runtime profile")
	}
	t.Setenv("RSRS_DATA_DIR", root)

	dir := filepath.Join(root, "client2")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	prefs := []byte(`{"language":"` + locale + `","onboardingCompleted":true,"proxyMode":"direct","theme":"dark"}`)
	if err := os.WriteFile(filepath.Join(dir, "preferences.json"), prefs, 0600); err != nil {
		t.Fatal(err)
	}

	m, err := host.New()
	if err != nil {
		t.Fatal(err)
	}
	if m.Endpoint != endpoint {
		t.Fatal("unexpected Runtime endpoint")
	}
	assets, err := fs.Sub(frontend, "frontend")
	if err != nil {
		t.Fatal(err)
	}
	loc, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := loc.Addr().(*net.TCPAddr).Port
	if err := loc.Close(); err != nil {
		t.Fatal(err)
	}
	receipt := os.Getenv("CARD018_EXPECTED_ISSUER")
	if raw, err := hex.DecodeString(receipt); err != nil || len(raw) != 16 || strings.ToLower(receipt) != receipt {
		t.Fatal("missing independently assigned Wails issuer")
	}
	d := &desktop{m: m}
	realHandler := card018StorageSettingsGate(d.handler(http.FileServer(http.FS(assets))), os.Getenv("CARD018_SYNTHETIC_DAY"))
	app := application.New(application.Options{Name: "Respire isolated fixture", Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Assets: application.AssetOptions{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Card018-Issuer", receipt)
			realHandler.ServeHTTP(w, r)
		}),
	}, Server: application.ServerOptions{Host: "127.0.0.1", Port: port, ShutdownTimeout: 5 * time.Second}})
	d.app = app
	url := fmt.Sprintf("http://127.0.0.1:%d", port)
	type report struct {
		output []byte
		err    error
	}
	done := make(chan report, 1)
	readyCtx, cancel := context.WithTimeout(context.Background(), 24*time.Second)
	defer cancel()
	go func() {
		defer app.Quit()
		probe := &http.Client{Timeout: time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		for i := 0; i < 50; i++ {
			r, err := probe.Get(url + "/api/state")
			if err != nil {
				time.Sleep(50 * time.Millisecond)
				continue
			}
			if r.Header.Get("X-Card018-Issuer") != receipt {
				r.Body.Close()
				done <- report{err: fmt.Errorf("unowned local fixture response")}
				return
			}
			var st struct {
				Ok     bool
				Result struct {
					Connected   bool
					Preferences struct{ Language string }
				}
			}
			decodeErr := json.NewDecoder(r.Body).Decode(&st)
			r.Body.Close()
			if decodeErr != nil || r.StatusCode != 200 || !st.Ok || !st.Result.Connected || st.Result.Preferences.Language != locale {
				done <- report{err: fmt.Errorf("exact fixture did not return localized connected desktop state")}
				return
			}
			browser := exec.CommandContext(readyCtx, os.Getenv("CARD018_NODE"), filepath.Join(os.Getenv("CARD018_SCRATCH"), "storage-settings-proof-browser.mjs"), url, locale)
			browser.Env = append(os.Environ(), "CARD018_OWNER_WAILS_ISSUER="+receipt)
			browser.Stdin = os.Stdin
			browser.Stdout = os.Stdout
			testErr := browser.Start()
			if testErr == nil {
				// Only the browser retains the proof output handle. Its half-close
				// signals EOF to the launcher before the after acknowledgement.
				_ = os.Stdout.Close()
				testErr = browser.Wait()
			}
			var out []byte
			done <- report{out, testErr}
			return
		}
		done <- report{err: fmt.Errorf("owned Wails server did not start")}
	}()
	if err := app.Run(); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-done:
		if result.err != nil {
			for _, line := range strings.Split(string(result.output), "\n") {
				if strings.HasPrefix(line, "FAIL: Session Import browser stage: ") && len(line) < 100 {
					t.Log(strings.TrimSpace(line))
				}
			}
			t.Fatal("browser probe failed")
		}
		t.Log("PASS isolated storage settings proof pipe")
	case <-readyCtx.Done():
		t.Fatal("browser fixture did not report")
	}
}
