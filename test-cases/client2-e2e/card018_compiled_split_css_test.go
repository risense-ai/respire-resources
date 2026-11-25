package desktop

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCard018ExactSplitCSS(t *testing.T) {
	real := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	const day = "2026-11-25"
	for name, makeGate := range map[string]func() http.Handler{
		"positive": func() http.Handler { return card018PositiveMemoryGate(real, day) },
		"settings": func() http.Handler { return card018StorageSettingsGate(real, day) },
		"diary": func() http.Handler { return card018DiaryAccountsGate(real, "diary", day) },
		"accounts": func() http.Handler { return card018DiaryAccountsGate(real, "accounts", day) },
	} {
		t.Run(name, func(t *testing.T) {
			for _, part := range []string{
				"/fonts.part1.css", "/fonts.part2.css", "/fonts.part3.css", "/fonts.part4.css", "/fonts.part5.css",
				"/dashboard.part1.css", "/dashboard.part2.css", "/dashboard.part3.css",
				"/memory/workspace.part1.css", "/memory/workspace.part2.css",
			} {
				for _, method := range []string{http.MethodGet, http.MethodHead} {
					out := httptest.NewRecorder()
					makeGate().ServeHTTP(out, httptest.NewRequest(method, part, nil))
					if out.Code != http.StatusNoContent {
						t.Errorf("%s %s: got %d", method, part, out.Code)
					}
				}
			}
			for _, part := range []string{"/fonts.part6.css", "/nested/fonts.part1.css",
				"/fonts.part1.css?q=1", "/fonts.part1.css?", "/memory/workspace.part3.css", "/other.extra.css"} {
				out := httptest.NewRecorder()
				makeGate().ServeHTTP(out, httptest.NewRequest(http.MethodGet, part, nil))
				if out.Code != http.StatusForbidden { t.Errorf("%s: got %d", part, out.Code) }
			}
			out := httptest.NewRecorder()
			makeGate().ServeHTTP(out, httptest.NewRequest(http.MethodPost, "/fonts.part1.css", nil))
			if out.Code != http.StatusForbidden { t.Errorf("CSS write: got %d", out.Code) }
		})
	}
}
