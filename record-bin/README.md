# 🗑 Record Bin

Record Bin is a DatoCMS plugin that makes it so every record that is deleted through the dasboard is sent to a Bin, where it can then be restored in a single click, or permanently deleted.

To use this plugin an auxiliary lambda function is needed. The deployment of that lambda function is further described bellow in the installation section.

# Installation and usage

The video above shows a step by step tutorial on how to install and use the plugin.
It follows the following instructions:

1. When you install the plugin, a modal will pop up prompting you to create the lambda function.
2. By clicking the Vercel Deploy button you can start a step by step process that will create that lambda function (You will be asked your projects Full API token!)
3. After deploying it, copy the Deployed URL and insert it in the modal, and "Finish installation"

The installation will then be complete, from then on, when you delete a record you will be able to find its trashed version inside a model called "🗑 Record Bin" (If the model doesn't exist it will be created).

If you open the trashed record inside that model, you will find a "Restore Record ♻️" button, that when clicked will restore the record, redirecting you to the resotred record, and deleting its trashed version.

In case the restoration fails a message will be shown, along with the option to see the entire API error log.
