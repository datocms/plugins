import { cn } from '@/lib/cn';

export type ImageProps = {
  base64: string;
  mediaType: string;
  className?: string;
  alt?: string;
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'>;

export function Image({
  base64,
  mediaType,
  className,
  alt,
  ...props
}: ImageProps) {
  return (
    <img
      {...props}
      alt={alt}
      className={cn('block h-auto max-w-full overflow-hidden', className)}
      src={`data:${mediaType};base64,${base64}`}
    />
  );
}
