const Ajv = require("ajv/dist/2020").default;
const schema = require("../src/shared/data/items/item-data.schema.json");
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

function validateItemDataShape(sources) {
  return validate(sources) ? [] : validate.errors.map(error => `${error.instancePath || "/"}: ${error.message}`);
}

module.exports = { validateItemDataShape };
