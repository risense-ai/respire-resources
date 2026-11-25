package desktop

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDiaryAccountsGate(t *testing.T) {
	for _, c := range []struct {
		lane, path, method, op, args string
		want                         int
	}{
		{"diary", "/api/execute", "POST", "diary_list", `{"from":"2026-11-01","to":"2026-11-30"}`, 204},
		{"diary", "/api/execute", "POST", "diary_list", `{"from":"2026-11-25","to":"2026-11-25"}`, 204},
		{"diary", "/api/execute", "POST", "diary_list", `{"from":"2026-11-01","to":"2026-12-01"}`, 403},
		{"diary", "/api/execute", "POST", "diary_list", `{"from":"2026-11-20","to":"2026-11-30"}`, 403},
		{"diary", "/api/execute", "POST", "diary_list", `{"from":"2026-11-01","to":"2026-11-30","contains":"other"}`, 403},
		{"diary", "/api/execute", "POST", "account_list", `{}`, 403},
		{"diary", "/api/execute", "POST", "diary_append", `{}`, 403},
		{"accounts", "/api/execute", "POST", "account_list", `{}`, 204},
		{"accounts", "/api/execute", "POST", "space_list", `{}`, 204},
		{"accounts", "/api/execute", "POST", "space_list", `{"account":"foreign"}`, 403},
		{"accounts", "/api/execute", "POST", "space_create", `{}`, 403},
		{"accounts", "/api/execute", "POST", "account_use", `{}`, 403},
		{"accounts", "/api/execute", "POST", "diary_list", `{"from":"2026-11-01","to":"2026-11-30"}`, 403},
		{"accounts", "/api/state?x=y", "GET", "", "", 403},
		{"unknown", "/api/state", "GET", "", "", 403},
	} {
		h := card018DiaryAccountsGate(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }), c.lane, "2026-11-25")
		body := ""
		if c.method == "POST" {
			body = `{"id":"desktop-11111111-aaaa-4111-8888-111111111111","name":"` + c.op + `","confirmed":true,"secret":"","args":` + c.args + `}`
		}
		r := httptest.NewRequest(c.method, c.path, strings.NewReader(body))
		r.Header.Set("X-Respire-Client", "1")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.want {
			t.Fatalf("%s/%s %s got %d want %d", c.lane, c.path, c.op, w.Code, c.want)
		}
	}
}
