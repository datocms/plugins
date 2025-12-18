import type { RenderModalCtx } from "datocms-plugin-sdk";
import { Button, Canvas, Form, SelectField } from "datocms-react-ui";
import { useEffect, useMemo, useState } from "react";
import type { SchemaTypes } from "@datocms/cma-client-browser";
import { makeClient } from "../services/cmaClient";
import styles from "./SelectCreatorModal.module.css";

type Props = {
	ctx: RenderModalCtx;
};

type ModalParameters = {
	preselectedUserId?: string;
	itemCount?: number;
};

type Option = {
	label: string;
	value: string;
};

type SingleValue<T> = T | null;
type OptionGroup<T> = {
	label?: string;
	options: T[];
};

type RawUser = Pick<SchemaTypes.User, "id"> & {
	attributes?: {
		full_name?: string | null;
		first_name?: string | null;
		last_name?: string | null;
		email?: string | null;
	};
	full_name?: string | null;
	email?: string | null;
};

export default function SelectCreatorModal({ ctx }: Props) {
	const params = useMemo<ModalParameters>(() => {
		return (ctx.parameters as ModalParameters) ?? {};
	}, [ctx.parameters]);

	const itemCount = params.itemCount ?? 0;
	const [options, setOptions] = useState<Option[]>([]);
	const [selectedUser, setSelectedUser] = useState<Option | null>(null);
	const [isLoading, setIsLoading] = useState<boolean>(false);
	const [fetchError, setFetchError] = useState<string | null>(null);
	const [selectionError, setSelectionError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function loadUsers() {
			if (!ctx.currentUserAccessToken) {
				setFetchError(
					"The plugin is missing the 'currentUserAccessToken' permission required to load collaborators.",
				);
				return;
			}

			setIsLoading(true);
			setFetchError(null);

			try {
				const client = makeClient(ctx.currentUserAccessToken, ctx.environment);
				const listResult = await client.users.list();
				if (cancelled) {
					return;
				}

				const users = extractUsers(listResult);
				const nextOptions = users.map(toOption);
				setOptions(nextOptions);

				if (params.preselectedUserId) {
					const match = nextOptions.find((option) => option.value === params.preselectedUserId);
					setSelectedUser(match ?? null);
				}
			} catch (error) {
				if (cancelled) {
					return;
				}
				const message =
					error instanceof Error
						? error.message
						: typeof error === "string"
						? error
						: "Unable to load collaborators.";
				setFetchError(message);
				setOptions([]);
				setSelectedUser(null);
			} finally {
				if (!cancelled) {
					setIsLoading(false);
				}
			}
		}

		loadUsers();

		return () => {
			cancelled = true;
		};
	}, [ctx.currentUserAccessToken, ctx.environment, params.preselectedUserId]);

	const title = useMemo(() => {
		if (itemCount <= 0) {
			return "Change creators";
		}
		const plural = itemCount === 1 ? "record" : "records";
		return `Change creators for ${itemCount} ${plural}`;
	}, [itemCount]);

	const errorMessage = fetchError ?? selectionError ?? undefined;

	const handleSelectChange = (option: SingleValue<Option>) => {
		setSelectedUser(option ?? null);
		setSelectionError(null);
	};

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!selectedUser) {
			setSelectionError("Select a collaborator to continue.");
			return;
		}
		ctx.resolve({ userId: selectedUser.value });
	};

	const handleCancel = () => {
		ctx.resolve(null);
	};

	return (
		<Canvas ctx={ctx}>
			<Form onSubmit={handleSubmit} className={styles.form}>
				<header className={styles.header}>
					<h2 className={styles.heading}>{title}</h2>
					<p className={styles.subheading}>
						Select a collaborator to assign as the new creator for the chosen records.
					</p>
				</header>
				<SelectField<Option, false, OptionGroup<Option>>
					id="new-creator"
					name="new-creator"
					label="New creator"
					required
					value={selectedUser}
					onChange={handleSelectChange}
					hint="Only collaborators with sufficient permissions are listed."
					error={errorMessage}
					selectInputProps={{
						options,
						isClearable: false,
						isDisabled: isLoading || Boolean(fetchError),
						isLoading,
						placeholder: isLoading
							? "Loading collaborators…"
							: options.length > 0
							? "Choose a collaborator"
							: "No collaborators available",
					}}
				/>
				<footer className={styles.footer}>
					<Button
						type="submit"
						buttonType="primary"
						disabled={isLoading || Boolean(fetchError) || !selectedUser}
					>
						Change creator
					</Button>
					<Button type="button" buttonType="muted" onClick={handleCancel}>
						Cancel
					</Button>
				</footer>
			</Form>
		</Canvas>
	);
}

function extractUsers(result: unknown): RawUser[] {
	if (Array.isArray(result)) {
		return result.filter(isRawUser);
	}

	if (result && typeof result === "object" && "data" in result) {
		const data = (result as { data?: unknown }).data;
		if (Array.isArray(data)) {
			return data.filter(isRawUser);
		}
	}

	return [];
}

function isRawUser(value: unknown): value is RawUser {
	if (value === null || typeof value !== "object") {
		return false;
	}
	return "id" in value && typeof (value as { id: unknown }).id === "string";
}

function toOption(user: RawUser): Option {
	const attributes = user.attributes ?? {};
	const nameParts = [attributes.first_name, attributes.last_name].filter(
		(part): part is string => Boolean(part && part.trim()),
	);
	const fullName =
		attributes.full_name && attributes.full_name.trim().length > 0
			? attributes.full_name
			: nameParts.join(" ");
	const label =
		fullName && fullName.trim().length > 0
			? fullName
			: attributes.email ?? user.email ?? `User ${user.id}`;
	return { label, value: user.id };
}
