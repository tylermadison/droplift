// Command droplift-engine is the upload engine sidecar. The Host starts it with --socket (PRD §9.2).
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/tylermadison/droplift/engine"
)

func main() {
	socket := flag.String("socket", "", "Unix socket path of the Host")
	flag.Parse()
	if *socket == "" {
		fmt.Fprintln(os.Stderr, "--socket is required")
		os.Exit(2)
	}
	conn, err := net.Dial("unix", *socket)
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect:", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := engine.Serve(ctx, conn, engine.Options{}); err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, "serve:", err)
		os.Exit(1)
	}
}
