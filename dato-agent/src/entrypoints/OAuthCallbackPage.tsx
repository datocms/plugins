import styles from './OAuthCallbackPage.module.css';

type Props = {
  error?: boolean;
  message: string;
};

export default function OAuthCallbackPage({ error = false, message }: Props) {
  return (
    <main className={styles.page}>
      <div className={styles.content} role={error ? 'alert' : 'status'}>
        <h1 className={error ? styles.error : undefined}>
          {error ? 'Connection could not be completed' : 'DatoCMS connected'}
        </h1>
        <p>{message}</p>
      </div>
    </main>
  );
}
