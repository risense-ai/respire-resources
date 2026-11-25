package desktop

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStorageSettingsGate(t *testing.T) {
	const own = "desktop-11111111-aaaa-4111-8888-111111111111"
	const unrelated = "desktop-22222222-aaaa-4222-8888-222222222222"
	cmd := func(name string, args map[string]any) map[string]any {
		return map[string]any{
			"name": name, "id": own, "confirmed": true, "secret": "", "args": args}
	}
	agent := cmd("agent_config", map[string]any{})
	for _, c := range []struct {
		name, method, path string
		body               map[string]any
		bootstrap          bool
		want               int
	}{
		{"agent", "POST", "/api/execute", agent, false, 204},
		{"scoped poll", "GET", "/api/operation?id=" + own, nil, true, 204},
		{"scoped ack", "POST", "/api/operation-ack", map[string]any{"id": own}, true, 204},
		{"state", "GET", "/api/state", nil, false, 204},
		{"status", "HEAD", "/api/runtime-status", nil, false, 204},
		{"no query", "GET", "/api/runtime-status?x=1", nil, false, 403},
		{"bare query", "GET", "/api/state?", nil, false, 403},
		{"wrong poll id", "GET", "/api/operation?id=" + unrelated, nil, true, 403},
		{"extra poll query", "GET", "/api/operation?id=" + own + "&x=1", nil, true, 403},
		{"wrong ack id", "POST", "/api/operation-ack", map[string]any{"id": unrelated}, true, 403},
		{"agent args", "POST", "/api/execute", cmd("agent_config", map[string]any{"workspace": "off"}), false, 403},
		{"model write", "POST", "/api/execute", cmd("model_configure", map[string]any{}), false, 403},
		{"preferences write", "POST", "/api/preferences", map[string]any{"theme": "light"}, false, 403},
		{"folder picker", "POST", "/api/file-dialog", map[string]any{"kind": "directory"}, false, 403},
		{"directory change", "POST", "/api/execute", cmd("data_dir_set", map[string]any{"dir": "D:/other"}), false, 403},
		{"agent change", "POST", "/api/execute", cmd("agent_set", map[string]any{"setting": "workspace_mode=off"}), false, 403},
		{"search not applicable", "POST", "/api/execute", cmd("memory_search", map[string]any{"query": "polar compass witness", "limit": 50}), false, 403},
	} {
		t.Run(c.name, func(t *testing.T) {
			n := 0
			gate := card018StorageSettingsGate(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { n++; w.WriteHeader(204) }), "2026-11-25")
			run := func(method, url string, body map[string]any) int {
				b, _ := json.Marshal(body)
				r := httptest.NewRequest(method, url, bytes.NewReader(b))
				r.Header.Set("X-Respire-Client", "1")
				r.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				gate.ServeHTTP(w, r)
				return w.Code
			}
			if c.bootstrap && run("POST", "/api/execute", agent) != 204 {
				t.Fatal("bootstrap refused")
			}
			initial := n
			if got := run(c.method, c.path, c.body); got != c.want {
				t.Fatalf("got %d, want %d", got, c.want)
			}
			if c.want == 403 && (initial != n || run("GET", "/api/state", nil) != 403) {
				t.Fatal("denial forwarded or failed to latch")
			}
		})
	}
}
