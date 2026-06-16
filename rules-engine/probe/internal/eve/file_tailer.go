package eve

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/nxadm/tail"
)

type FileTailer struct {
	path          string
	startPosition string
}

func NewFileTailer(path, startPosition string) *FileTailer {
	return &FileTailer{path: path, startPosition: startPosition}
}

func (t *FileTailer) Tail(ctx context.Context) (<-chan string, <-chan error, error) {
	seek := &tail.SeekInfo{Offset: 0, Whence: io.SeekEnd}
	if t.startPosition == "beginning" {
		seek = &tail.SeekInfo{Offset: 0, Whence: io.SeekStart}
	}

	tailer, err := tail.TailFile(t.path, tail.Config{
		ReOpen:        true,
		Follow:        true,
		MustExist:     false,
		Poll:          true,
		Location:      seek,
		CompleteLines: true,
		Logger:        tail.DiscardingLogger,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("tail eve file: %w", err)
	}

	lines := make(chan string)
	errs := make(chan error, 1)

	go func() {
		defer close(lines)
		defer close(errs)
		defer tailer.Cleanup()

		for {
			select {
			case <-ctx.Done():
				_ = tailer.Stop()
				return
			case line, ok := <-tailer.Lines:
				if !ok {
					return
				}
				if line == nil {
					continue
				}
				if line.Err != nil {
					select {
					case errs <- line.Err:
					default:
					}
					continue
				}

				text := strings.TrimSpace(line.Text)
				if text == "" {
					continue
				}

				select {
				case lines <- text:
				case <-ctx.Done():
					_ = tailer.Stop()
					return
				}
			}
		}
	}()

	return lines, errs, nil
}
