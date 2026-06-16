package eve

import (
	"bufio"
	"context"
	"fmt"
	"net"
)

type Reader interface {
	Tail(ctx context.Context) (<-chan string, <-chan error, error)
}

type FileReader struct {
	path          string
	startPosition string
}

func NewReader(path, startPosition string) (Reader, error) {
	if path == "" {
		return nil, fmt.Errorf("eve path is required")
	}
	return &FileReader{path: path, startPosition: startPosition}, nil
}

func (r *FileReader) Tail(ctx context.Context) (<-chan string, <-chan error, error) {
	// Delegate to original file tailing logic
	return NewFileTailer(r.path, r.startPosition).Tail(ctx)
}

type TCPListener struct {
	addr string
}

func NewTCPListener(addr string) (Reader, error) {
	if addr == "" {
		return nil, fmt.Errorf("tcp listen address is required")
	}
	return &TCPListener{addr: addr}, nil
}

func (l *TCPListener) Tail(ctx context.Context) (<-chan string, <-chan error, error) {
	ln, err := net.Listen("tcp", l.addr)
	if err != nil {
		return nil, nil, fmt.Errorf("tcp listen %s: %w", l.addr, err)
	}

	lines := make(chan string, 100)
	errs := make(chan error, 1)

	go func() {
		defer close(lines)
		defer close(errs)
		defer ln.Close()

		for {
			conn, err := ln.Accept()
			if err != nil {
				select {
				case errs <- err:
				default:
				}
				continue
			}

			go func(c net.Conn) {
				defer c.Close()
				scanner := bufio.NewScanner(c)
				for scanner.Scan() {
					select {
					case lines <- scanner.Text():
					case <-ctx.Done():
						return
					}
				}
			}(conn)
		}
	}()

	return lines, errs, nil
}
