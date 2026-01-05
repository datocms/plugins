import { connect } from "datocms-plugin-sdk";
import "datocms-react-ui/styles.css";
import { render } from "./utils/render";
import { AssetLocalizationChecker } from "./components/AssetLocalizationChecker.tsx";

connect({
  overrideFieldExtensions(field) {
    if (field.attributes.field_type === "file") {
      return {
        addons: [
          {
            id: "assetLocalizationChecker",
          },
        ],
      };
    }
  },
  renderFieldExtension(id, ctx) {
    if (id === "assetLocalizationChecker") {
      render(<AssetLocalizationChecker ctx={ctx} />);
    }
  },
});
