/**
 * User Profile Card Component - Minimal Design
 */

import { useState, useCallback } from 'react';
import type { UserInfo } from '@utils/userTransformers';
import type { UserOverride } from '@utils/pluginParams';
import { getGravatarUrl } from '@/utils/helpers';
import {
  ImageIcon,
  DeleteIcon,
  EditIcon,
  CloseIcon,
} from './Icons';
import styles from '@styles/userprofilesettings.module.css';

type PropTypes = {
  user: UserInfo;
  override?: UserOverride;
  avatarUrl: string | null;
  onNameChange: (name: string) => void;
  onAvatarSelect: () => void;
  onAvatarRemove: () => void;
};

const UserProfileCard = ({
  user,
  override,
  avatarUrl,
  onNameChange,
  onAvatarSelect,
  onAvatarRemove,
}: PropTypes) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localName, setLocalName] = useState(override?.nameOverride ?? '');

  const displayAvatarUrl = avatarUrl ?? user.avatarUrl ?? getGravatarUrl(user.email || 'default', 72);
  const hasCustomAvatar = override?.uploadId !== undefined;
  const hasAlias = override?.nameOverride !== undefined;

  const handleSaveName = useCallback(() => {
    const trimmed = localName.trim();
    onNameChange(trimmed);
    setIsEditing(false);
  }, [localName, onNameChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSaveName();
      } else if (e.key === 'Escape') {
        setLocalName(override?.nameOverride ?? '');
        setIsEditing(false);
      }
    },
    [handleSaveName, override?.nameOverride]
  );

  const handleClearAlias = useCallback(() => {
    setLocalName('');
    onNameChange('');
  }, [onNameChange]);

  const handleStartEditing = useCallback(() => {
    setLocalName(override?.nameOverride ?? '');
    setIsEditing(true);
  }, [override?.nameOverride]);

  return (
    <div className={styles.userCard}>
      {/* Avatar - click to change */}
      <div className={styles.avatarSection}>
        <button
          type="button"
          className={styles.avatarWrapper}
          onClick={onAvatarSelect}
          title="Set avatar from assets"
          aria-label={`Change avatar for ${user.name}`}
        >
          <img
            src={displayAvatarUrl}
            alt={user.name}
            className={styles.avatar}
            onError={(e) => {
              const target = e.currentTarget;
              target.onerror = null; // Prevent infinite loop
              target.src = getGravatarUrl(user.email || 'default', 72);
            }}
          />
        </button>
      </div>

      {/* Name info */}
      <div className={styles.infoSection}>
        <span className={styles.originalName}>{user.name}</span>

        {isEditing ? (
          <input
            type="text"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={handleKeyDown}
            placeholder="Alias"
            className={styles.nameInput}
            autoFocus
          />
        ) : hasAlias ? (
          <>
            <span className={styles.aliasArrow}>→</span>
            <button
              type="button"
              className={styles.aliasName}
              onClick={handleStartEditing}
              aria-label={`Edit alias "${override.nameOverride}"`}
            >
              {override.nameOverride}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.setAlias}
            onClick={handleStartEditing}
            aria-label={`Set alias for ${user.name}`}
          >
            Set alias
          </button>
        )}
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        {hasAlias && !isEditing && (
          <button
            className={styles.iconBtn}
            onClick={handleClearAlias}
            title="Clear alias"
          >
            <CloseIcon />
          </button>
        )}
        {!isEditing && (
          <button
            className={styles.iconBtn}
            onClick={handleStartEditing}
            title="Edit alias"
          >
            <EditIcon />
          </button>
        )}
        <button
          className={styles.iconBtn}
          onClick={onAvatarSelect}
          title="Set avatar from assets"
        >
          <ImageIcon />
        </button>
        {hasCustomAvatar && (
          <button
            className={styles.iconBtn}
            onClick={onAvatarRemove}
            title="Remove custom avatar"
          >
            <DeleteIcon />
          </button>
        )}
      </div>
    </div>
  );
};

export default UserProfileCard;
