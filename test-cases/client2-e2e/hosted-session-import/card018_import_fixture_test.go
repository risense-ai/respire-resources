//go:build server

package desktop

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"respire-client2/internal/host"
)

func TestCard018ActualDesktopImportBoundary(t *testing.T) {
	if os.Getenv("CARD018_PREVIEW_ONLY") != "1" {
		t.Fatal("cannot mount preview without native preflight")
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
	prefs := []byte(`{"language":"` + locale + `","onboardingCompleted":true,"proxyMode":"direct"}`)
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
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		t.Fatal(err)
	}
	receipt := hex.EncodeToString(random[:])
	d := &desktop{m: m}
	realHandler := card018ImportPreviewGate(d.handler(http.FileServer(http.FS(assets))))
	app := application.New(application.Options{Name: "Respire isolated fixture", Assets: application.AssetOptions{
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
			browser := exec.CommandContext(readyCtx, os.Getenv("CARD018_NODE"), filepath.Join(os.Getenv("CARD018_SCRATCH"), "import-real-probe.mjs"), url, locale)
			out, testErr := browser.CombinedOutput()
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
		t.Log("browser probe verified one native dry-run at two widths")
	case <-readyCtx.Done():
		t.Fatal("browser fixture did not report")
	}
}

var previewOperationID = regexp.MustCompile(`^desktop-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// This test-only gate passes through accepted requests verbatim. It cannot
// invoke product operations on its own or turn an unexpected request into success.
func card018ImportPreviewGate(real http.Handler) http.Handler {
	var mu sync.Mutex
	seen := map[string]bool{}
	previewCount := 0
	discovered := false
	denied := false
	reads := map[string]bool{"session_import_targets": true, "session_import_preview": true,
		"query_log": true, "model_profile_list": true, "diary_list": true, "organize_suggestions": true,
		"capabilities": true, "model_profiles": true}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		refuse := func() { mu.Lock(); denied = true; mu.Unlock(); w.WriteHeader(http.StatusForbidden) }
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			if !strings.HasPrefix(r.URL.Path, "/api/") {
				real.ServeHTTP(w, r)
				return
			}
			switch r.URL.Path {
			case "/api/state", "/api/runtime-status", "/api/operations", "/api/fonts":
				real.ServeHTTP(w, r)
				return
			case "/api/operation":
				mu.Lock()
				ok := seen[r.URL.Query().Get("id")]
				mu.Unlock()
				if ok {
					real.ServeHTTP(w, r)
					return
				}
			}
			refuse()
			return
		}
		if r.Method != http.MethodPost || (r.URL.Path != "/api/execute" && r.URL.Path != "/api/operation-ack") ||
			r.URL.RawQuery != "" || r.Header.Get("X-Respire-Client") != "1" || r.Header.Get("Content-Type") != "application/json" {
			refuse()
			return
		}
		const maxBytes = 8192
		b, err := io.ReadAll(io.LimitReader(r.Body, maxBytes+1))
		r.Body.Close()
		var request struct {
			Name      string
			ID        string
			Args      json.RawMessage
			Confirmed bool
			Secret    string
		}
		if err != nil || len(b) > maxBytes || json.Unmarshal(b, &request) != nil || !previewOperationID.MatchString(request.ID) ||
			request.Secret != "" {
			refuse()
			return
		}
		mu.Lock()
		ok := !denied
		if r.URL.Path == "/api/execute" {
			// Client2 execute sets confirmed for reads too. Only these read specs can pass.
			ok = ok && reads[request.Name] && !seen[request.ID] && len(seen) < 32
			if request.Name == "session_import_preview" && ok {
				var fields map[string]json.RawMessage
				argOK := json.Unmarshal(request.Args, &fields) == nil
				for key, value := range fields {
					switch key {
					case "id":
						argOK = argOK && string(value) == "\"codex\""
					case "limit":
						var limit int
						argOK = argOK && json.Unmarshal(value, &limit) == nil && limit > 0 && limit <= 2000
					default:
						argOK = false
					}
				}
				ok = argOK && discovered && previewCount == 0
				if ok {
					previewCount++
				}
			}
			if ok {
				seen[request.ID] = true
				discovered = discovered || request.Name == "session_import_targets"
			}
		} else {
			ok = ok && seen[request.ID] && request.Name == "" && !request.Confirmed
		}
		mu.Unlock()
		if !ok {
			refuse()
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(b))
		real.ServeHTTP(w, r)
	})
}
