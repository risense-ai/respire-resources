package desktop

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPositiveMemoryGate(t *testing.T) {
	const list = "desktop-11111111-aaaa-4111-8888-111111111111"
	const search = "desktop-22222222-aaaa-4222-8888-222222222222"
	const other = "desktop-33333333-aaaa-4333-8888-333333333333"
	body := func(id, name string, args map[string]any) map[string]any {
		return map[string]any{"id": id, "name": name, "secret": "", "confirmed": true, "args": args}
	}
	listBody := body(list, "memory_list", map[string]any{"limit": 500})
	searchBody := body(search, "memory_search", map[string]any{"query": "polar compass witness", "limit": 50})
	for _, tc := range []struct {
		name, method, path string
		request            map[string]any
		listed, searched   bool
		want               int
	}{
		{"state", "GET", "/api/state", nil, false, false, 204},
		{"font", "HEAD", "/api/fonts", nil, false, false, 204},
		{"extra-query", "GET", "/api/state?x=3", nil, false, false, 403},
		{"bare-query", "GET", "/api/state?", nil, false, false, 403},
		{"exact-search", "POST", "/api/execute", searchBody, true, false, 204},
		{"early-search", "POST", "/api/execute", searchBody, false, false, 403},
		{"repeat-search", "POST", "/api/execute", body(other, "memory_search", map[string]any{"query": "polar compass witness", "limit": 50}), true, true, 403},
		{"wrong-query", "POST", "/api/execute", body(search, "memory_search", map[string]any{"query": "other", "limit": 50}), true, false, 403},
		{"wrong-id", "POST", "/api/execute", body("invalid", "memory_search", map[string]any{"query": "polar compass witness", "limit": 50}), true, false, 403},
		{"business-write", "POST", "/api/execute", body(search, "memory_create", map[string]any{}), true, false, 403},
		{"preferences", "POST", "/api/preferences", map[string]any{"language": "zh"}, false, false, 403},
		{"correct-poll", "GET", "/api/operation?id=" + list, nil, true, false, 204},
		{"bad-poll", "GET", "/api/operation?id=" + other, nil, true, false, 403},
		{"poll-duplicate", "GET", "/api/operation?id=" + list + "&id=" + list, nil, true, false, 403},
		{"bad-ack", "POST", "/api/operation-ack", map[string]any{"id": other}, true, false, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			forwarded := 0
			handler := card018PositiveMemoryGate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded++; w.WriteHeader(204) }), "2026-11-25")
			request := func(method, path string, body map[string]any) int {
				b, _ := json.Marshal(body)
				r := httptest.NewRequest(method, path, bytes.NewReader(b))
				r.Header.Set("X-Respire-Client", "1")
				r.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, r)
				return w.Code
			}
			if tc.listed && request("POST", "/api/execute", listBody) != 204 {
				t.Fatal("fixture list failed")
			}
			if tc.searched && request("POST", "/api/execute", searchBody) != 204 {
				t.Fatal("fixture search failed")
			}
			before := forwarded
			if got := request(tc.method, tc.path, tc.request); got != tc.want {
				t.Fatalf("got %d want %d", got, tc.want)
			}
			if tc.want == 403 && (forwarded != before || request("GET", "/api/state", nil) != 403) {
				t.Fatal("deny latch or no-forward invariant lost")
			}
		})
	}
}
