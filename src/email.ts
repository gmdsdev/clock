import { Resend } from "resend";
const resend = new Resend(import.meta.env.VITE_RESEND_API_KEY);

export const send2FA = async () => {
  const { data } = await resend.emails.send({
    from: "dev.guih@gmail.com",
    to: "dev.guih@gmail.com",
    replyTo: "you@example.com",
    subject: "hello world",
    text: "it works!",
  });

  console.log(data);
};
