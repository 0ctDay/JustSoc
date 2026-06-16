'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type SliderCaptchaPayload = {
  kind: 'slider';
  captchaId: string;
  backgroundImage: string;
  puzzleImage: string;
  imageWidth: number;
  imageHeight: number;
  pieceWidth: number;
  pieceHeight: number;
  pieceY: number;
  maxOffset: number;
  expiresAt: string;
};

type SliderCaptchaStatus = 'idle' | 'verifying' | 'verified' | 'failed';

type SliderCaptchaProps = {
  challenge: SliderCaptchaPayload | null;
  value: number;
  loading: boolean;
  disabled?: boolean;
  status: SliderCaptchaStatus;
  message?: string;
  onChange: (value: number) => void;
  onVerify: (offset: number) => Promise<void> | void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function statusLabel(status: SliderCaptchaStatus) {
  if (status === 'verified') return '已通过';
  if (status === 'verifying') return '校验中';
  if (status === 'failed') return '未通过';
  return '待验证';
}

export default function SliderCaptcha({
  challenge,
  value,
  loading,
  disabled,
  status,
  message,
  onChange,
  onVerify,
}: SliderCaptchaProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startClientX: number; startValue: number; lastValue: number; moved: boolean } | null>(null);
  const [renderedWidth, setRenderedWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!stageRef.current) return undefined;

    const element = stageRef.current;
    const updateSize = () => setRenderedWidth(element.clientWidth);
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [challenge?.captchaId]);

  useEffect(() => {
    if (!dragging || !challenge) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragRef.current) return;
      const scale = renderedWidth > 0 ? renderedWidth / challenge.imageWidth : 1;
      const delta = (event.clientX - dragRef.current.startClientX) / (scale || 1);
      const nextValue = clamp(Math.round(dragRef.current.startValue + delta), 0, challenge.maxOffset);
      dragRef.current.lastValue = nextValue;
      dragRef.current.moved = dragRef.current.moved || Math.abs(nextValue - dragRef.current.startValue) >= 4;
      onChange(nextValue);
    };

    const stopDragging = () => {
      const snapshot = dragRef.current;
      dragRef.current = null;
      setDragging(false);

      if (!snapshot?.moved || loading || disabled || status === 'verifying' || status === 'verified') {
        return;
      }

      void onVerify(snapshot.lastValue);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    };
  }, [challenge, disabled, dragging, loading, onChange, onVerify, renderedWidth, status]);

  const scale = useMemo(() => {
    if (!challenge || renderedWidth <= 0) return 1;
    return renderedWidth / challenge.imageWidth;
  }, [challenge, renderedWidth]);

  if (!challenge) {
    return <div className="empty-hint">正在加载滑块验证码...</div>;
  }

  const pieceLeft = value * scale;
  const pieceWidth = challenge.pieceWidth * scale;
  const pieceHeight = challenge.pieceHeight * scale;
  const pieceTop = challenge.pieceY * scale;
  const trackPercent = challenge.maxOffset > 0 ? (value / challenge.maxOffset) * 100 : 0;

  return (
    <div className="slider-captcha-shell">
      <div className="slider-captcha-head">
        <span className={`slider-captcha-badge slider-captcha-badge-${status}`}>{statusLabel(status)}</span>
        <span className="slider-captcha-message">
          {message || (status === 'verified' ? '验证通过，可以继续登录。' : '按住滑块拖到缺口位置，松手后自动校验。')}
        </span>
      </div>

      <div className="slider-captcha-frame" style={{ maxWidth: `${challenge.imageWidth}px` }}>
        <div
          ref={stageRef}
          className="slider-captcha-stage"
          style={{ aspectRatio: `${challenge.imageWidth} / ${challenge.imageHeight}` }}
        >
          <img className="slider-captcha-background" alt="滑块验证码背景" src={challenge.backgroundImage} draggable={false} />
          <div
            className={`slider-captcha-piece${dragging ? ' slider-captcha-piece-dragging' : ''}`}
            style={{
              width: `${pieceWidth}px`,
              height: `${pieceHeight}px`,
              top: `${pieceTop}px`,
              transform: `translateX(${pieceLeft}px)`,
            }}
          >
            <img alt="滑块拼图" src={challenge.puzzleImage} draggable={false} />
          </div>
        </div>

        <div className="slider-captcha-controls">
          <div className="slider-captcha-track">
            <div className="slider-captcha-track-fill" style={{ width: `${trackPercent}%` }} />
            <div className="slider-captcha-track-label">
              {status === 'verifying' ? '正在校验位置...' : dragging ? '松开后自动校验' : '拖动滑块完成验证'}
            </div>
            <button
              className={`slider-captcha-handle${dragging ? ' slider-captcha-handle-dragging' : ''}`}
              type="button"
              disabled={disabled || loading || status === 'verifying'}
              style={{ left: `clamp(4px, calc(${trackPercent}% - 22px), calc(100% - 48px))` }}
              onPointerDown={(event) => {
                dragRef.current = {
                  startClientX: event.clientX,
                  startValue: value,
                  lastValue: value,
                  moved: false,
                };
                setDragging(true);
              }}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}