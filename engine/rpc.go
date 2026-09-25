// Package engine is the Droplift upload engine: a JSON-RPC 2.0 peer of the Host over a Unix socket (PRD §9.2).
package engine

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Options are the engine's system boundaries. Zero values mean the real ones.
type Options struct {
	HTTPClient *http.Client
	Now        func() time.Time
}

type message struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// session is one connection to the Host. Requests go both ways, one JSON message per line.
type session struct {
	opts    Options
	writeMu sync.Mutex
	enc     *json.Encoder

	callMu  sync.Mutex
	nextID  int
	waiting map[string]chan message
}

// Serve handles one Host connection until it closes or ctx ends.
func Serve(ctx context.Context, conn io.ReadWriteCloser, opts Options) error {
	s := &session{opts: opts, enc: json.NewEncoder(conn), waiting: map[string]chan message{}}
	go func() { <-ctx.Done(); conn.Close() }()

	scan := bufio.NewScanner(conn)
	scan.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for scan.Scan() {
		var msg message
		if err := json.Unmarshal(scan.Bytes(), &msg); err != nil {
			continue
		}
		if msg.Method == "" {
			s.deliver(msg)
			continue
		}
		go s.handle(ctx, msg)
	}
	return scan.Err()
}

func (s *session) send(msg message) {
	msg.JSONRPC = "2.0"
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	s.enc.Encode(msg)
}

func (s *session) handle(ctx context.Context, req message) {
	result, err := s.dispatch(ctx, req.Method, req.Params)
	if req.ID == nil {
		return
	}
	if err != nil {
		s.send(message{ID: req.ID, Error: &rpcError{Code: -32000, Message: err.Error()}})
		return
	}
	raw, _ := json.Marshal(result)
	s.send(message{ID: req.ID, Result: raw})
}

func (s *session) dispatch(ctx context.Context, method string, params json.RawMessage) (any, error) {
	switch method {
	case "dest.test":
		var p destTestParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		return s.destTest(ctx, p), nil
	case "upload.enqueue":
		var p uploadParams
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		return s.upload(ctx, p)
	case "aws.profiles":
		return awsProfiles()
	}
	return nil, fmt.Errorf("unknown method %q", method)
}

// call sends a request to the Host and waits for its result.
func (s *session) call(ctx context.Context, method string, params, result any) error {
	s.callMu.Lock()
	s.nextID++
	id := "e" + strconv.Itoa(s.nextID)
	reply := make(chan message, 1)
	s.waiting[id] = reply
	s.callMu.Unlock()

	rawParams, _ := json.Marshal(params)
	rawID, _ := json.Marshal(id)
	s.send(message{ID: rawID, Method: method, Params: rawParams})

	select {
	case <-ctx.Done():
		return ctx.Err()
	case msg := <-reply:
		if msg.Error != nil {
			return fmt.Errorf("%s: %s", method, msg.Error.Message)
		}
		return json.Unmarshal(msg.Result, result)
	}
}

func (s *session) deliver(msg message) {
	var id string
	json.Unmarshal(msg.ID, &id)
	s.callMu.Lock()
	reply, ok := s.waiting[id]
	delete(s.waiting, id)
	s.callMu.Unlock()
	if ok {
		reply <- msg
	}
}

func (s *session) now() time.Time {
	if s.opts.Now != nil {
		return s.opts.Now()
	}
	return time.Now()
}
