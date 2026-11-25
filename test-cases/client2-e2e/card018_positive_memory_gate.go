package desktop

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"sync"
)

// Separate positive-memory fixture transport, never used by empty Stats or
// Session Import. This gate does not mint auth or fabricate handler results.
func card018PositiveMemoryGate(real http.Handler, syntheticDay string) http.Handler {
	var mu sync.Mutex
	seen := map[string]string{}
	latched := false
	listed := false
	searched := false
	handle := func(r *http.Request) bool {
		if latched {
			return false
		}
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			if r.URL.Path == "/api/operation" {
				query := r.URL.Query()
				id := query.Get("id")
				return len(query) == 1 && len(query["id"]) == 1 && r.URL.RawQuery == "id="+id && seen[id] != ""
			}
			if r.URL.RawQuery != "" || r.URL.ForceQuery {
				return false
			}
			if positiveAssetPath.MatchString(r.URL.Path) {
				return true
			}
			switch r.URL.Path {
			case "/api/state", "/api/runtime-status", "/api/operations", "/api/fonts", "/api/inject-targets", "/api/model-profile-state":
				return true
			}
			return false
		}
		if r.Method != http.MethodPost || r.URL.RawQuery != "" || r.URL.ForceQuery ||
			(r.URL.Path != "/api/execute" && r.URL.Path != "/api/operation-ack") ||
			r.Header.Get("X-Respire-Client") != "1" || r.Header.Get("Content-Type") != "application/json" {
			return false
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 2049))
		r.Body.Close()
		var outer map[string]json.RawMessage
		if err != nil || len(body) > 2048 || json.Unmarshal(body, &outer) != nil {
			return false
		}
		var id, name, secret string
		if json.Unmarshal(outer["id"], &id) != nil || !positiveOperationID.MatchString(id) {
			return false
		}
		if r.URL.Path == "/api/operation-ack" {
			if len(outer) != 1 || seen[id] == "" {
				return false
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			return true
		}
		if len(outer) != 5 || json.Unmarshal(outer["name"], &name) != nil || json.Unmarshal(outer["secret"], &secret) != nil ||
			string(outer["secret"]) != "\"\"" || string(outer["confirmed"]) != "true" || seen[id] != "" || len(seen) >= 32 {
			return false
		}
		var args map[string]json.RawMessage
		if json.Unmarshal(outer["args"], &args) != nil || args == nil {
			return false
		}
		equalString := func(key, want string) bool {
			var got string
			return json.Unmarshal(args[key], &got) == nil && got == want
		}
		ok := false
		switch name {
		case "capabilities":
			ok = len(args) == 0
		case "diary_list":
			ok = len(args) == 2 && positiveDay.MatchString(syntheticDay) && equalString("from", syntheticDay) && equalString("to", syntheticDay)
		case "organize_suggestions":
			ok = len(args) == 1 && string(args["top"]) == "50"
		case "query_log":
			ok = len(args) == 2 && string(args["stats"]) == "true" && string(args["limit"]) == "1"
		case "memory_list":
			ok = string(args["limit"]) == "500" && (len(args) == 1 || len(args) == 2 && string(args["metadata"]) == "true")
			if ok {
				listed = true
			}
		case "memory_search":
			ok = listed && !searched && len(args) == 2 && equalString("query", "polar compass witness") && string(args["limit"]) == "50"
			if ok {
				searched = true
			}
		}
		if ok {
			seen[id] = name
			r.Body = io.NopCloser(bytes.NewReader(body))
		}
		return ok
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		allowed := handle(r)
		if !allowed {
			latched = true
		}
		mu.Unlock()
		if !allowed {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		real.ServeHTTP(w, r)
	})
}

var positiveOperationID = regexp.MustCompile(`^desktop-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
var positiveDay = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
var positiveAssetPath = regexp.MustCompile(`^/(workspace\.html|client\.js|fonts\.part[1-5]\.css|dashboard\.part[1-3]\.css|memory/workspace\.part[1-2]\.css|[^./][A-Za-z0-9_-]*(/[A-Za-z0-9_-]+)*\.(js|css|svg|woff2|ico))$`)
