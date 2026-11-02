import { Global, Module } from "@nestjs/common";
import { AppConfig } from "../config/app-config.service";
import { RequestContextService } from "../common/request-context.service";
import { SecretCipher } from "../common/crypto/secret-cipher";

@Global()
@Module({
  providers: [
    RequestContextService,
    {
      provide: SecretCipher,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new SecretCipher(config.encryptionKey),
    },
  ],
  exports: [RequestContextService, SecretCipher],
})
export class SecurityModule {}
