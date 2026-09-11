import './Skeleton.css';

/**
 * Pulsing placeholder block. Pass width/height as CSS lengths (e.g. "96px", "40%").
 */
export default function Skeleton({
  width,
  height,
  circle = false,
  className = '',
  style,
  ...rest
}) {
  const merged = { ...style };
  if (width != null) merged['--skeleton-w'] = typeof width === 'number' ? `${width}px` : width;
  if (height != null) merged['--skeleton-h'] = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={`skeleton${circle ? ' skeleton-circle' : ''}${className ? ` ${className}` : ''}`}
      style={merged}
      aria-hidden="true"
      {...rest}
    />
  );
}
