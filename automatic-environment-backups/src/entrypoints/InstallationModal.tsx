import { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Form, TextField } from 'datocms-react-ui';
import { useState } from 'react';
import attemptNetlifyInitialization from '../utils/attemptNetlifyInitialization';

type PropTypes = {
  ctx: RenderModalCtx;
};

const InstallationModal = ({ ctx }: PropTypes) => {
  const [netlifyURL, setNetlifyURL] = useState('');
  const [isInvalid, setIsInvalid] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleDeployButtonClick = () => {
    window.open(
      `https://app.netlify.com/start/deploy?repository=https://github.com/marcelofinamorvieira/datocms-backups-scheduled-netlify-function`
    );
  };

  const handleCancelationButtonClick = () => {
    ctx.updatePluginParameters({ installationState: 'cancelled' });
    ctx.resolve('cancelled');
  };

  const handleFinishButtonClick = async () => {
    setIsLoading(true);
    try {
      await attemptNetlifyInitialization(netlifyURL);
      await ctx.updatePluginParameters({
        installationState: 'installed',
        netlifyURL: netlifyURL,
      });
      await ctx.resolve('installed');
    } catch {
      setIsLoading(false);
      setIsInvalid(true);
    }
  };

  return (
    <Canvas ctx={ctx}>
      <div style={{ textAlign: 'center' }}>
        <h1>Before continuing:</h1>
        <p>
          This plugin requires a scheduled function to manage the forking and
          deletion of environments every week/day. By clicking the deploy button
          bellow you can create your own instance of that scheduled function.
          Once you are finished with the setup, insert the deployment URL in the
          field bellow.
        </p>
        <p>
          If you'd like, you also can see, clone, and read the documentation on
          that scheduled function on{' '}
          <a
            href="https://github.com/marcelofinamorvieira/datocms-backups-scheduled-netlify-function"
            target="_blank"
            rel="noreferrer"
          >
            this repository
          </a>
        </p>
        <h2>You can create your instance of that scheduled function here:</h2>
        <Form>
          <Button
            onClick={handleDeployButtonClick}
            fullWidth
            buttonType="muted"
          >
            Deploy on Netlify
          </Button>

          <h2>One more step before finishing:</h2>

          <p>
            Before inserting the URL, you will have to activate the "Scheduled
            function" feature on your Netlify project. This will allow the
            serverless function to run daily and weekly.
          </p>

          <p>
            To see how to enable this feature on your netlify project{' '}
            <a
              href="https://github.com/marcelofinamorvieira/datocms-backups-scheduled-netlify-function#enabling-the-scheduled-function-feature-on-netlify"
              target="_blank"
              rel="noreferrer"
            >
              click here
            </a>
          </p>

          <TextField
            name="netlifyURL"
            id="email"
            label="Once deployed, insert your deployed URL"
            value={netlifyURL}
            placeholder="https://automated-backup.netlify.app"
            error={isInvalid ? 'Please insert a valid URL' : ''}
            onChange={(newValue) => {
              setIsInvalid(false);
              setNetlifyURL(newValue);
            }}
          />
          <Button
            fullWidth
            buttonType={isLoading ? 'muted' : 'primary'}
            disabled={isLoading}
            onClick={handleFinishButtonClick}
          >
            Finish installation
          </Button>
          <Button
            fullWidth
            buttonType="negative"
            onClick={handleCancelationButtonClick}
          >
            Cancel installation
          </Button>
        </Form>
      </div>
    </Canvas>
  );
};

export default InstallationModal;
