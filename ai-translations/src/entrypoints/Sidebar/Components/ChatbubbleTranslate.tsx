import { AnimatePresence, type Easing, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { AiOutlineOpenAI } from 'react-icons/ai';
import { BsCheckCircleFill, BsXCircleFill } from 'react-icons/bs';
import styles from '../../../styles.module.css';
import { PENDING_HINT_THRESHOLD_SECONDS } from '../../../utils/constants';
import { formatLocaleLabel } from '../../../utils/localeUtils';

/**
 * ChatbubbleTranslate.tsx
 *
 * This component renders a single chat bubble representing the translation status of a given field-locale pair.
 * It receives props describing the field being translated, the target locale, and the current status.
 *
 * The component uses Framer Motion for animations:
 * - When status is 'pending', the bubble displays a spinning OpenAI icon to indicate ongoing translation.
 * - When the status changes to 'done', the bubble transitions smoothly, stops spinning, and displays a checkmark.
 * - When the status is 'error', the bubble shows an error icon and error styling.
 *
 * Props:
 * - bubble: {
 *     fieldLabel: string;   // The name/label of the field being translated.
 *     locale: string;       // The locale into which the field is being translated.
 *     status: 'pending'|'done'|'error'; // Current translation status for this field-locale.
 *     fieldPath: string;    // The path to the field in the CMS for potential navigation or identification.
 *     errorMessage?: string; // Optional error message when status is 'error'.
 *   }
 * - index: number;          // Index of this bubble in the list for potential staggered animations.
 */

type BubbleType = {
  id: string; // stable unique id (e.g., api_key.locale)
  fieldLabel: string;
  locale: string;
  status: 'pending' | 'done' | 'error';
  fieldPath: string;
  streamingContent?: string;
  errorMessage?: string;
};

type Props = {
  bubble: BubbleType;
  // NOTE: index is intentionally kept for future staggered animation support.
  // The parent component passes this for potential animation delays based on
  // bubble position. Currently unused but preserved for backwards compatibility
  // and to avoid breaking the parent component's prop spreading pattern.
  index: number;
};

export function ChatBubble({ bubble }: Props) {
  // Hover behavior removed in full-response mode
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    if (bubble.status === 'pending') {
      setElapsedSec(0);
      t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    }
    return () => {
      if (t) clearInterval(t);
    };
  }, [bubble.status]);

  // Streaming preview disabled for full-response mode

  // Variants for framer-motion to animate bubble appearance and transitions
  const bubbleVariants = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  };

  const tooltipVariants = {
    initial: {
      opacity: 0,
      scale: 0.95,
    },
    animate: {
      opacity: 1,
      scale: 1,
      transition: {
        opacity: {
          duration: 0.2,
          ease: 'easeOut' as Easing,
        },
        scale: {
          duration: 0.2,
          ease: 'easeOut' as Easing,
        },
      },
    },
    exit: {
      opacity: 0,
      scale: 0.95,
      transition: {
        opacity: {
          duration: 0.15,
          ease: 'easeIn' as Easing,
        },
        scale: {
          duration: 0.15,
          ease: 'easeIn' as Easing,
        },
      },
    },
  };

  // Removed streaming text animations in full-response mode

  // Show hint only for long-running fields
  const showPendingHint =
    bubble.status === 'pending' && elapsedSec >= PENDING_HINT_THRESHOLD_SECONDS;

  // Conditional icon animation:
  // - If status is 'pending', rotate continuously.
  // - If status is 'done' or 'error', stop rotation (no animation).
  const iconAnimation =
    bubble.status === 'pending'
      ? {
          rotate: [0, 360],
          transition: {
            duration: 1,
            ease: 'linear' as Easing,
            repeat: Number.POSITIVE_INFINITY,
          },
        }
      : {
          rotate: 0,
          transition: { duration: 0.2 },
        };

  // Icon to indicate status: same OpenAI icon, but spinning if pending, static if done
  // Could switch icon if desired, but instructions say not to remove/change functionality.
  // We'll keep the same icon and just stop spinning when done.
  return (
    <AnimatePresence>
      <motion.div
        key={bubble.id}
        layout
        variants={bubbleVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className={`${styles.bubbleContainer} ${
          bubble.status === 'done' ? styles.done : ''
        } ${bubble.status === 'error' ? styles.error : ''}`}
      >
        <motion.div
          className={styles.bubble}
        >
          <motion.div
            className={styles.bubbleIcon}
            animate={iconAnimation}
          >
            <AiOutlineOpenAI size={20} />
          </motion.div>

          <div className={styles.bubbleContent}>
            <span className={styles.bubbleText}>
              “<strong>{bubble.fieldLabel}</strong>” to{' '}
              <strong>{formatLocaleLabel(bubble.locale)}</strong> [
              <code>{bubble.locale}</code>]
            </span>
          </div>
          {bubble.status === 'done' && (
            <BsCheckCircleFill size={16} className={styles.bubbleStatusIcon} />
          )}
          {bubble.status === 'error' && (
            <BsXCircleFill size={16} className={styles.bubbleStatusIcon} />
          )}
        </motion.div>

        <div className={styles.streamingContainer}>
          {/* subtle connector to the bubble above for better visual grouping */}
          <AnimatePresence mode="wait">
            {showPendingHint && (
              <motion.div
                variants={tooltipVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className={styles.pendingHint}
              >
                <span className={styles.pendingPulseText}>
                  Translating a large field: not stuck
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
