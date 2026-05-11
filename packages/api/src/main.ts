import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

const rootEnv = path.join(process.cwd(), "../../.env");
if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
}async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.enableCors({ origin: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Radar API")
    .setDescription("Скелет API: health и проверка БД.")
    .setVersion("0.1.0")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  const port = process.env.PORT ?? "3000";
  await app.listen(Number(port), "0.0.0.0");
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
