const apiKey = "sd_81ha8i3c_mrn6uev0";
const baseUrl = "https://vvdance.ai";
const requestPath = "/api/v3/images/generations";
const body = {
  model: "seedream-5-0-lite-260128",
  prompt: "Generate a clean city-street poster at sunrise, with crisp details and no text or logo",
  image: [""],
  size: "2K",
  response_format: "url",
  stream: false,
  sequential_image_generation: "disabled"
};

const bodyText = JSON.stringify(body);

fetch(baseUrl + requestPath, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + apiKey
  },
  body: bodyText
}).then(async (response) => {
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  console.log(result);
});