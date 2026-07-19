import type { IRawMessageTelegramExtensionRepository } from "@radar/shared";
import type { DataSource } from "typeorm";
import { RawMessageTelegramEntity } from "../entities/ingest";
import { IsNull } from "typeorm";

export class TypeOrmRawMessageTelegramExtensionRepository
  implements IRawMessageTelegramExtensionRepository
{
  constructor(private readonly dataSource: DataSource) {}

  async findDuplicate(
    chatId: string,
    messageId: string,
    editDate: string | null,
  ): Promise<string | null> {
    const repo = this.dataSource.getRepository(RawMessageTelegramEntity);
    const row = await repo.findOne({
      where: {
        chatId,
        messageId,
        editDate: editDate ? new Date(editDate) : IsNull(),
      },
    });
    return row?.rawMessageId ?? null;
  }

  async insertInTransaction(
    manager: DataSource["manager"],
    extension: {
      rawMessageId: string;
      chatId: string;
      messageId: string;
      editDate: string | null;
      peerType?: string;
    },
  ): Promise<void> {
    const repo = manager.getRepository(RawMessageTelegramEntity);
    const row = repo.create({
      rawMessageId: extension.rawMessageId,
      chatId: extension.chatId,
      messageId: extension.messageId,
      editDate: extension.editDate ? new Date(extension.editDate) : null,
      peerType: extension.peerType ?? null,
    });
    await repo.save(row);
  }
}
