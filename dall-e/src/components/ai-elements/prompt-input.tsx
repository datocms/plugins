import {
  type ComponentProps,
  type FormEvent,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type TextareaHTMLAttributes,
  useCallback,
} from 'react';
import { CornerDownLeftIcon, SquareIcon, XIcon } from 'lucide-react';
import { Spinner } from 'datocms-react-ui';
import { cn } from '@/lib/cn';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/registry/default/ui/input-group';

export type PromptInputMessage = {
  text: string;
  files: [];
};

export type PromptInputStatus = 'submitted' | 'streaming' | 'error';

export type PromptInputProps = Omit<
  React.FormHTMLAttributes<HTMLFormElement>,
  'onSubmit'
> & {
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>;
};

const TEXTAREA_SELECTOR = 'textarea[data-prompt-input-textarea="true"]';

export function PromptInput({
  className,
  onSubmit,
  children,
  ...props
}: PromptInputProps) {
  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const textarea = event.currentTarget.querySelector<HTMLTextAreaElement>(
        TEXTAREA_SELECTOR,
      );

      onSubmit(
        {
          text: textarea?.value || '',
          files: [],
        },
        event,
      );
    },
    [onSubmit],
  );

  return (
    <form className={cn('block', className)} onSubmit={handleSubmit} {...props}>
      <InputGroup className="h-full">{children}</InputGroup>
    </form>
  );
}

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export function PromptInputBody({ className, ...props }: PromptInputBodyProps) {
  return <div className={cn('flex flex-1', className)} {...props} />;
}

export type PromptInputHeaderProps = ComponentProps<typeof InputGroupAddon>;

export function PromptInputHeader({ className, ...props }: PromptInputHeaderProps) {
  return <InputGroupAddon className={cn('order-first flex-wrap gap-2 border-t-0 pt-0', className)} {...props} />;
}

export type PromptInputFooterProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  'align'
>;

export function PromptInputFooter({ className, ...props }: PromptInputFooterProps) {
  return (
    <InputGroupAddon
      align="block-end"
      className={cn('justify-between gap-3', className)}
      {...props}
    />
  );
}

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export function PromptInputTools({ className, ...props }: PromptInputToolsProps) {
  return <div className={cn('flex min-w-0 items-center gap-2', className)} {...props} />;
}

export type PromptInputTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function PromptInputTextarea({
  className,
  onChange,
  onKeyDown,
  placeholder = 'Describe the image you want to generate',
  rows = 1,
  ...props
}: PromptInputTextareaProps) {
  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      onKeyDown?.(event);

      if (event.defaultPrevented) {
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        const submitButton = event.currentTarget.form?.querySelector<HTMLButtonElement>(
          'button[type="submit"]',
        );

        if (!submitButton?.disabled) {
          event.currentTarget.form?.requestSubmit();
        }
      }
    },
    [onKeyDown],
  );

  return (
    <InputGroupTextarea
      {...props}
      className={cn(className)}
      data-prompt-input-textarea="true"
      onChange={onChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      rows={rows}
    />
  );
}

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: PromptInputStatus;
  onStop?: () => void;
};

export function PromptInputSubmit({
  className,
  variant = 'default',
  size = 'default',
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) {
  const isGenerating = status === 'submitted' || status === 'streaming';

  let icon = <CornerDownLeftIcon className="size-4" />;

  if (status === 'submitted') {
    icon = <Spinner size={14} style={{ marginLeft: 0, transform: 'none' }} />;
  } else if (status === 'streaming') {
    icon = <SquareIcon className="size-4" />;
  } else if (status === 'error') {
    icon = <XIcon className="size-4" />;
  }

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (isGenerating && onStop) {
        event.preventDefault();
        onStop();
        return;
      }

      onClick?.(event);
    },
    [isGenerating, onClick, onStop],
  );

  return (
    <InputGroupButton
      aria-label={isGenerating ? 'Stop' : 'Submit'}
      className={cn(className)}
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? 'button' : 'submit'}
      variant={variant}
      {...props}
    >
      {children ? (
        <>
          {status === 'submitted' ? (
            <Spinner size={14} style={{ marginLeft: 0, transform: 'none' }} />
          ) : null}
          <span>{children}</span>
        </>
      ) : (
        icon
      )}
    </InputGroupButton>
  );
}
