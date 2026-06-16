package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"justsoc/probe/internal/enrich"
	"justsoc/probe/internal/eve"
)

const (
	publishBufferSize    = 4096
	publishBatchSize     = 100
	publishFlushInterval = 200 * time.Millisecond
)

type Sink interface {
	PublishBatch(ctx context.Context, events []eve.Event) error
}

type Runner struct {
	reader     eve.Reader
	parser     *eve.Parser
	enricher   *enrich.Enricher
	sink       Sink
	logger     *slog.Logger
	correlator *correlator
}

func NewRunner(reader eve.Reader, parser *eve.Parser, enricher *enrich.Enricher, sink Sink, logger *slog.Logger) *Runner {
	return &Runner{reader: reader, parser: parser, enricher: enricher, sink: sink, logger: logger, correlator: newCorrelator()}
}

func (r *Runner) Run(ctx context.Context) error {
	lines, errs, err := r.reader.Tail(ctx)
	if err != nil {
		return err
	}

	publishCtx, publishCancel := context.WithCancel(ctx)
	defer publishCancel()

	publishQueue := make(chan eve.Event, publishBufferSize)
	defer close(publishQueue)

	publishErrs := make(chan error, 1)
	go func() {
		if err := r.publishLoop(publishCtx, publishQueue); err != nil && err != context.Canceled {
			select {
			case publishErrs <- err:
			default:
			}
			publishCancel()
		}
	}()

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-publishErrs:
			return err
		case <-ticker.C:
			if err := r.enqueueReady(publishCtx, publishQueue, r.correlator.FlushExpired(time.Now())); err != nil {
				return err
			}
		case tailErr, ok := <-errs:
			if ok && tailErr != nil {
				r.logger.Warn("eve tail warning", "error", tailErr)
			}
		case line, ok := <-lines:
			if !ok {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				return fmt.Errorf("eve stream closed")
			}

			event, err := r.parser.Parse(line)
			if err != nil {
				r.logger.Warn("skip invalid eve line", "error", err)
				continue
			}

			if err := r.enqueueReady(publishCtx, publishQueue, r.correlator.Process(time.Now(), event)); err != nil {
				return err
			}
		}
	}
}

func (r *Runner) enqueueReady(ctx context.Context, queue chan<- eve.Event, events []eve.Event) error {
	for _, event := range events {
		enriched := r.enricher.Apply(event)
		select {
		case queue <- enriched:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func (r *Runner) publishLoop(ctx context.Context, queue <-chan eve.Event) error {
	timer := time.NewTimer(publishFlushInterval)
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}

	batch := make([]eve.Event, 0, publishBatchSize)
	for {
		var timerCh <-chan time.Time
		if len(batch) > 0 {
			timerCh = timer.C
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timerCh:
			if err := r.sink.PublishBatch(ctx, batch); err != nil {
				return err
			}
			batch = batch[:0]
		case event, ok := <-queue:
			if !ok {
				if len(batch) == 0 {
					return nil
				}
				return r.sink.PublishBatch(ctx, batch)
			}

			batch = append(batch, event)
			if len(batch) == 1 {
				timer.Reset(publishFlushInterval)
			}
			if len(batch) < publishBatchSize {
				continue
			}
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			if err := r.sink.PublishBatch(ctx, batch); err != nil {
				return err
			}
			batch = batch[:0]
		}
	}
}
