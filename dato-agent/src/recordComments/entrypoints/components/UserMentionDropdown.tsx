import type { UserInfo } from '@hooks/useMentions';
import Avatar from 'datocms-react-ui/Avatar';
import { UserIcon } from '../../../icons';
import { MentionDropdownBase } from './shared/MentionDropdownBase';

type UserMentionDropdownProps = {
  users: UserInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (user: UserInfo) => void;
  onClose: () => void;
  position?: 'above' | 'below';
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  onSelectedIndexChange?: (index: number) => void;
};

function emptyText(query: string, isLoading: boolean, error: string | null) {
  if (isLoading) return 'Loading people…';
  if (error) return error;
  return query ? `No users match “${query}”` : 'No users available';
}

function statusText(isLoading: boolean, error: string | null) {
  if (isLoading) return 'Loading people…';
  if (error) return 'Couldn’t refresh people.';
  return undefined;
}

const UserMentionDropdown = ({
  users,
  query,
  selectedIndex,
  onSelect,
  onClose,
  position = 'below',
  isLoading = false,
  errorMessage = null,
  onRetry,
  onSelectedIndexChange,
}: UserMentionDropdownProps) => (
  <MentionDropdownBase
    busy={isLoading}
    emptyMessage={emptyText(query, isLoading, errorMessage)}
    headerIcon={<UserIcon />}
    headerText="People"
    items={users}
    keyExtractor={(user) => user.id}
    onClose={onClose}
    onRetry={errorMessage && onRetry ? onRetry : undefined}
    onSelect={onSelect}
    onSelectedIndexChange={onSelectedIndexChange}
    position={position}
    renderOption={(user) => ({
      image: (
        <Avatar email={user.email} imageUrl={user.avatarUrl} name={user.name} />
      ),
      title: user.name,
      details: user.email,
    })}
    selectedIndex={selectedIndex}
    status={statusText(isLoading, errorMessage)}
  />
);

export default UserMentionDropdown;
