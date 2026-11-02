import Heading from 'datocms-react-ui/Heading';
import Main from 'datocms-react-ui/Main';
import styles from './OAuthCallbackPage.module.css';

type Props = {
  error?: boolean;
  message: string;
};

// The popup that the sign-in returns to. It is not a frame of the plugin, so
// it has no ctx and no Canvas: it uses only components that need neither.
export default function OAuthCallbackPage({ error = false, message }: Props) {
  return (
    <Main className={styles.page}>
      <div className={styles.content} role={error ? 'alert' : 'status'}>
        <Heading level={1} className={styles.title}>
          {error ? 'Connection could not be completed' : 'Finishing sign-in'}
        </Heading>
        <p className={styles.message}>{message}</p>
      </div>
    </Main>
  );
}
