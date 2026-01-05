import type { Environment } from "@datocms/cma-client/dist/types/generated/ApiTypes";

type EnvItemsProps = {
  env: Environment;
  currentEnv: string;
  uploadId: string;
  projectDomain: string | null;
};

export const EnvItem = ({
  env,
  currentEnv,
  uploadId,
  projectDomain,
}: EnvItemsProps) => {
  const {
    meta: { primary: isPrimary },
  } = env;

  const isCurrent: boolean = currentEnv === env.id;
  const uploadUrlInEnv: string | undefined = isCurrent
    ? undefined
    : isPrimary
      ? `https://${projectDomain}/media/assets/${uploadId}`
      : `https://${projectDomain}/environments/${env.id}/media/assets/${uploadId}`;

  return (
    <li style={{ fontWeight: isCurrent ? "bold" : "unset" }}>
      <a href={uploadUrlInEnv} target="_top">
        {env.id} {isPrimary && <span>(primary)</span>}{" "}
        {isCurrent && <span>(current)</span>}
      </a>
    </li>
  );
};
