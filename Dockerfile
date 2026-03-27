FROM node:20-slim

WORKDIR /app

# 复制 package.json
COPY package*.json ./

# 安装依赖（包括 devDependencies，因为需要 tsx）
RUN npm install

# 复制源代码
COPY . .

# 暴露端口
EXPOSE 8080

# 启动服务
CMD ["npm", "start"]
