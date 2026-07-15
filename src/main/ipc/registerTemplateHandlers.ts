import { z } from 'zod'
import {
  CreateTemplateInputSchema,
  UpdateTemplateInputSchema,
} from '../../shared/contracts/template'
import type { TemplateService } from '../templates/templateService'
import { DEFAULT_TEMPLATE_ID } from '../templates/defaultTemplate'

interface TemplateIpcMain {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

type TemplateServicePort = Pick<TemplateService, 'list' | 'create' | 'update' | 'reorderSections' | 'delete'>
const TemplateIdSchema = z.string().trim().min(1).max(200)
const MutableTemplateIdSchema = TemplateIdSchema.refine((id) => id !== DEFAULT_TEMPLATE_ID, 'The default template is immutable')
const SectionOrderSchema = z.array(z.string().uuid()).min(1).max(8)

export function registerTemplateHandlers(ipcMain: TemplateIpcMain, service: TemplateServicePort): void {
  ipcMain.handle('templates:list', () => service.list())
  ipcMain.handle('templates:create', (_event, input) => service.create(CreateTemplateInputSchema.parse(input)))
  ipcMain.handle('templates:update', (_event, id, input) => service.update(
    MutableTemplateIdSchema.parse(id),
    UpdateTemplateInputSchema.parse(input),
  ))
  ipcMain.handle('templates:reorder-sections', (_event, id, orderedSectionIds) => service.reorderSections(
    MutableTemplateIdSchema.parse(id),
    SectionOrderSchema.parse(orderedSectionIds),
  ))
  ipcMain.handle('templates:delete', (_event, id) => service.delete(MutableTemplateIdSchema.parse(id)))
}
