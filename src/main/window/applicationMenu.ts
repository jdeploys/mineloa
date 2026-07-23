import { Menu, type MenuItemConstructorOptions } from 'electron'

export function buildApplicationMenuTemplate(
  appName: string,
  isMac: boolean,
  reopenMainWindow: () => void,
): MenuItemConstructorOptions[] {
  return [
    ...(isMac
      ? [{
          label: appName,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
              { type: 'separator' as const },
              { role: 'startSpeaking' as const },
              { role: 'stopSpeaking' as const },
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const },
            ]),
      ],
    },
    {
      label: 'Window',
      submenu: [
        {
          label: appName,
          accelerator: 'CmdOrCtrl+0',
          click: reopenMainWindow,
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
  ]
}

export function installApplicationMenu(
  appName: string,
  isMac: boolean,
  reopenMainWindow: () => void,
): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(buildApplicationMenuTemplate(appName, isMac, reopenMainWindow)),
  )
}
