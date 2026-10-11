import { Global, Module } from '@nestjs/common';
import { AbilityFactory } from './auth/ability.factory';

@Global()
@Module({
  providers: [AbilityFactory],
  exports: [AbilityFactory],
})
export class CommonModule {}
