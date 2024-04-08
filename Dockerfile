###################################
# NODE
###################################
# Get initial image
FROM node:16.15 as node

# Set the working directory
WORKDIR /app

# Copy the package details to be able to install the correct versions
COPY ./package.json ./
COPY ./package-lock.json ./

# Install the correct version of angular
RUN npm install

# Copy the all other files
COPY . ./

# Build it
RUN npm run ng build --tag inlogit/software:guidedog -- --configuration=production

###################################
# NGINX
###################################
# Get initial image
FROM nginx:1.17.1-alpine

# Change the config files
COPY ./docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=node /app/dist/model-repair-of-petri-nets /usr/share/nginx/html

# Expose some ports
EXPOSE 4200