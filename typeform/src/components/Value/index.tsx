import { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { State } from "../../types";
import { fetchFormById } from "../store";
import { ValueProps } from "../../types";
import style from "./styles.module.css";

export default function Value({ value, client, onReset, ctx }: ValueProps) {
  const dispatch = useDispatch();

  const findForm = useCallback(
    (id: string) => {
      dispatch(fetchFormById({ id, client }));
    },
    [client, dispatch]
  );

  useEffect(() => {
    findForm(value);
  }, [value, findForm]);

  const { form, status, results } = useSelector((state: State) => {
    const info = state.forms[value] || {
      status: "loading",
      result: null,
    };

    const form = info.result;

    return {
      status: info.status,
      form:
        form && form.theme
          ? Object.assign({}, form, { theme: state.themes[form.theme.href] })
          : form,
      results: state.results[value],
    };
  });

  let backgroundImage = null;

  if (form && form.theme && form.theme.background) {
    backgroundImage = form.theme.background.href;
  } else if (
    form &&
    form.welcome_screens &&
    form.welcome_screens.length > 0 &&
    form.welcome_screens[0].attachment
  ) {
    backgroundImage = form.welcome_screens[0].attachment.href;
  }

  return (
    <div className={status === "loading" ? style.value__loading : style.value}>
      {form && !form.code && (
        <div className={style.value__form}>
          <div
            className={style.value__form__image}
            style={{
              backgroundImage: backgroundImage ? `url(${backgroundImage})` : "",
              backgroundColor:
                form.theme && form.theme.colors && form.theme.colors.background,
            }}
          />
          <div className={style.value__form__info}>
            <div className={style.value__form__title}>
              <a
                href={form._links.display}
                target="_blank"
                rel="noopener noreferrer"
              >
                {form.title}
              </a>
            </div>
            <div className={style.value__form__description}>
              {form.welcome_screens && form.welcome_screens.length > 0 && (
                <p>{form.welcome_screens[0].title}</p>
              )}
            </div>
            {form.fields && (
              <div className={style.value__form__form__info}>
                <strong>Fields:</strong>
                &nbsp;
                {form.fields.length}
                &nbsp;
                <span>fields</span>
              </div>
            )}
            {results && (
              <a
                href={`https://admin.typeform.com/form/${form.id}/results`}
                target="_blank"
                rel="noopener noreferrer"
                className={style.value__form__form__info}
              >
                <strong>Responses:</strong>
                &nbsp;
                {results.total_items}
                &nbsp;
                <span>responses</span>
              </a>
            )}
          </div>
        </div>
      )}
      <button type="button" onClick={onReset} className={style.value__reset} />
    </div>
  );
}
