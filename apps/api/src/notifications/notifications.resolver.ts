import { Resolver } from '@nestjs/graphql';

@Resolver()
export class NotificationsResolver {
  constructor(private readonly notificationsService: any) {}
}
