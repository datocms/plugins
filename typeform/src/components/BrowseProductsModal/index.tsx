import { useDispatch, useSelector } from "react-redux";
import { State, onSelectType, Form } from "../../types";
import Client from "../client";
import { RenderModalCtx } from "datocms-plugin-sdk";
import { fetchFormsMatching } from "../store";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button, TextInput, Canvas } from "datocms-react-ui";
import style from "./styles.module.css";

export default function BrowseProductsModal({ ctx }: { ctx: RenderModalCtx }) {
  const dispatch = useDispatch();
  const [sku, setSku] = useState<string>("");

  const corsUrlPrefix = ctx.plugin.attributes.parameters
    .corsUrlPrefix as string;
  const apiToken = ctx.plugin.attributes.parameters.apiToken as string;

  const client = useMemo(() => {
    return new Client({ apiToken, corsUrlPrefix });
  }, [corsUrlPrefix, apiToken]);

  const performSearch = useCallback(
    (query: string) => {
      dispatch(fetchFormsMatching({ query, client }));
    },
    [client, dispatch]
  );

  const { query, status, forms } = useSelector((state: State) => {
    const search = state.searches[state.query] || {
      status: "loading",
      result: [],
    };

    return {
      query: state.query,
      status: search.status,
      forms: search.result.map((id: string) => {
        const form = state.forms[id].result;

        return form && form.theme
          ? Object.assign({}, form, { theme: state.themes[form.theme.href] })
          : form;
      }),
    };
  });

  useEffect(() => {
    performSearch(query);
  }, [performSearch, query]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (sku) {
      performSearch(sku);
    }
  };

  const handleSelect: onSelectType = ({ form }) => {
    ctx.resolve({ form });
  };

  const renderResult = ({ form }: { form: Form }) => {
    return (
      <div
        key={form.id}
        onClick={() => handleSelect({ form })}
        className={style.empty__form}
      >
        <div
          className={style.empty__form__bg}
          style={{
            backgroundImage:
              form.theme &&
              form.theme.background &&
              `url(${form.theme.background.href})`,
            backgroundColor: form.theme && form.theme.colors.background,
          }}
        >
          <div
            className={style.empty__form__title}
            style={{ color: form.theme && form.theme.colors.question }}
          >
            {form.title}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Canvas ctx={ctx}>
      <div className={style.empty}>
        <form className={style.empty__search} onSubmit={handleSubmit}>
          <div className={style.empty__search__input}>
            <TextInput
              placeholder="Search for SKU or titles... (ie. baseball cap)"
              id="sku"
              name="sku"
              value={sku}
              onChange={setSku}
            />
          </div>
          <Button
            type="submit"
            buttonType="negative"
            buttonSize="s"
            className={
              status === "loading" ? style.button__loading : style.button
            }
          >
            Search
            <span className={style.spinner} />
          </Button>
        </form>
        {forms.filter((x: any) => !!x) && (
          <div
            className={
              status === "loading"
                ? style.empty__forms__loading
                : style.empty__forms
            }
          >
            {forms.map((form: Form) => renderResult({ form }))}
          </div>
        )}
      </div>
    </Canvas>
  );
}
