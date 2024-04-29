import { Inject, Injectable, Logger } from '@nestjs/common';
import { NATS_SERVICE, envs } from 'src/config';
import Stripe from 'stripe';
import { PaymentSessionDto } from './dto/payment-session.dto';
import { Request, Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class PaymentsService {
  private readonly stripe = new Stripe(envs.stripeSecret);
  private readonly logger = new Logger('PaymentsService');

  constructor(
    @Inject(NATS_SERVICE) private readonly client:ClientProxy
  ){

  }

  async createPaymentSession(paymentSessionDto: PaymentSessionDto) {
    const { currency, items, orderId } = paymentSessionDto;
    const lineItems = items.map((item) => {
      return {
        price_data: {
          currency: currency,
          product_data: {
            name: item.name,
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      };
    });

    const session = await this.stripe.checkout.sessions.create({
      payment_intent_data: {
        metadata: {
          orderId: orderId,
        },
      },

      line_items: lineItems,
      mode: 'payment',
      success_url: envs.stripeSuccessURL,
      cancel_url: envs.stripeCancelURL,
    });

    //return session;
    return {
      cancelUrl: session.cancel_url,
      successUrl: session.success_url,
      url: session.url,
    }
  }

  /* Para pruebas se utiliza:
https://dashboard.hookdeck.com/connections
 */
  async stripeWebhook(req: Request, res: Response) {
    const sig = req.headers['stripe-signature'];
    const endpoint_secret = envs.stripeEndPointSecret;
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        req['rawBody'],
        sig,
        endpoint_secret,
      );
    } catch (err) {
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }
    //console.log('event', event);

    switch (event.type) {
      case 'charge.succeeded':
        //TODO: Llamar a nuestro microservicio
        const chargeSucceded = event.data.object;
        const payload = {
          stripePaymentId: chargeSucceded.id,
          orderId: chargeSucceded.metadata.orderId,
          receiptUrl: chargeSucceded.receipt_url,
        } 
        this.logger.log(`Payment was successful for order ${payload.orderId}`);
        this.client.emit('payment.succeeded', payload);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return res.status(200).json({ sig });
  }
}
