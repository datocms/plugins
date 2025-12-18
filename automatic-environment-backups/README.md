# Automatic environment backups

This is a DatoCMS plugin that automatically creates a daily and weekly backup of your main environment, cycling the backups if they are not in use.

To use this plugin an auxiliary scheduled Netlify function is needed. The deployment of that scheduled function is further described bellow in the installation section.

# Installation and usage

The video above shows a step by step tutorial on how to install and use the plugin.
It follows the following instructions:

1. When you install the plugin, a modal will pop up prompting you to create the scheduled function.

2. By clicking the Netlify Deploy button you can start a step by step process that will create that scheduled function (You will be asked your projects Full API token!)

3. Enable the feature on [your Netlify Labs page](https://app.netlify.com/user/labs)

![image](https://user-images.githubusercontent.com/44898680/193444733-32151c30-4ae2-49cf-acec-af7fa1090d25.png)

4. Then, in the deployed instance of this repository go to the Functions tab, and click "Enable Scheduled Functions"

![image](https://user-images.githubusercontent.com/44898680/193444888-ddc09b42-aa6e-4b84-b2b6-2822e0743cb5.png)

5. Finally, copy the Deployed URL and insert it in the modal, and "Finish installation"

The installation will then be complete, from then on, every day the main environment will be forked to an environment labled ("daily-backup") with a timestamp, and will replace the older backup environment (if it hasn't been promoted to the primary environment)
The same goes for the weekly backup, which is also time-stamped in its own environment labled ("weekly-backup")

To stop the automatic backups you can simply deactivate the netlify instance and uninstall the plugin.
