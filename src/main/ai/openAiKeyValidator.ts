import OpenAI from 'openai'

interface OpenAiModelsClient {
  models: {
    list(): Promise<unknown>
  }
}

export type OpenAiClientFactory = (apiKey: string) => OpenAiModelsClient

const createOpenAiClient: OpenAiClientFactory = (apiKey) => new OpenAI({ apiKey })

export class OpenAiKeyValidator {
  constructor(private readonly createClient: OpenAiClientFactory = createOpenAiClient) {}

  async validate(value: string): Promise<void> {
    if (!value.startsWith('sk-')) {
      throw new Error('OpenAI API key must start with sk-')
    }

    await this.createClient(value).models.list()
  }
}
