// PROTOTYPE — spike 02. Throwaway. Droplift engine sidecar stand-in:
// connects to the Host's Unix socket and speaks newline-delimited JSON-RPC 2.0.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"runtime"
	"sync"
)

type msg struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *int64          `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   any             `json:"error,omitempty"`
}

func main() {
	sock := flag.String("socket", "", "unix socket path")
	flag.Parse()
	if *sock == "" {
		fmt.Fprintln(os.Stderr, "--socket required")
		os.Exit(2)
	}
	conn, err := net.Dial("unix", *sock)
	if err != nil {
		fmt.Fprintln(os.Stderr, "dial:", err)
		os.Exit(1)
	}
	defer conn.Close()

	var mu sync.Mutex
	enc := json.NewEncoder(conn) // Encode appends '\n'
	send := func(m msg) {
		m.JSONRPC = "2.0"
		mu.Lock()
		defer mu.Unlock()
		_ = enc.Encode(m)
	}

	// Unsolicited notification right after connect (no id).
	send(msg{Method: "net.state", Params: json.RawMessage(fmt.Sprintf(
		`{"online":true,"pid":%d,"arch":%q}`, os.Getpid(), runtime.GOARCH))})

	var count int64
	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	for sc.Scan() {
		var req msg
		if err := json.Unmarshal(sc.Bytes(), &req); err != nil {
			send(msg{Error: map[string]any{"code": -32700, "message": "parse error"}})
			continue
		}
		switch req.Method {
		case "ping":
			count++
			var p struct{ Seq int64 `json:"seq"` }
			_ = json.Unmarshal(req.Params, &p)
			send(msg{ID: req.ID, Result: map[string]any{"pong": true, "seq": p.Seq, "count": count}})
		case "shutdown":
			send(msg{ID: req.ID, Result: map[string]any{"bye": true, "count": count}})
			return
		default:
			send(msg{ID: req.ID, Error: map[string]any{"code": -32601, "message": "method not found"}})
		}
	}
}
