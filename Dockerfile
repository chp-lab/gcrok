FROM node:latest

WORKDIR /app

COPY package.json /app/
RUN rm -f app/yarn.lock
COPY yarn.lock /app/

RUN yarn install --production && yarn cache clean

COPY . /app

ENV NODE_ENV production
ENTRYPOINT ["node", "./gcrok.js"]
