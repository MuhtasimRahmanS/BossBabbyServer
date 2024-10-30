// Importing required modules
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Initialize the Express app
const app = express();
const port = process.env.PORT || 5000;

// Middleware Setup
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(express.json());

// MongoDB connection string and client setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kaoye.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// MongoDB client instance
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Function to start the server and handle database operations
async function run() {
  try {
    // MongoDB collection reference
    const productCollection = client.db("bossbaby").collection("allProduct");
    const orderCollection = client.db("bossbaby").collection("allOrders");

    // API endpoints

    app.get("/products/:category", async (req, res) => {
      const category = req.params.category; // Capture the category from the route parameter

      // Query to filter by category
      let query = {};
      if (category) {
        query.category = category; // Filter by category
      }

      try {
        // Fetching products from MongoDB based on the filter and limiting to 10 results
        const result = await productCollection.find(query).limit(10).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/product/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productCollection.findOne(query);
      res.send(result);
    });

    app.get("/related/:category/:excludeId", async (req, res) => {
      const { category, excludeId } = req.params;

      // Query to filter by category and exclude the current product
      let query = { category: category }; // Filter by category

      try {
        // Convert excludeId to ObjectId only if it's a valid 24-character hex string
        if (ObjectId.isValid(excludeId)) {
          query._id = { $ne: new ObjectId(excludeId) }; // Exclude the product with this ID
        } else {
          return res.status(400).send({ message: "Invalid product ID" });
        }

        // Fetching products from MongoDB excluding the current product and limiting to 4
        const result = await productCollection.find(query).limit(4).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/search", async (req, res) => {
      const { q } = req.query;

      if (!q) {
        return res.status(400).send({ message: "Query is required" });
      }

      try {
        const regex = new RegExp(q, "i"); // Case-insensitive search
        const products = await productCollection
          .find({ name: { $regex: regex } })
          .toArray();

        res.send(products);
      } catch (error) {
        console.error("Error fetching search results:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/all-product", async (req, res) => {
      const filter = req.query.filter; // This can be a category like 'boys', 'girls', etc.
      const limit = parseInt(req.query.limit) || 10;
      const page = parseInt(req.query.page) || 1;
      const skip = (page - 1) * limit;

      try {
        // Build a dynamic filter object
        const query = {};
        if (filter) {
          query.category = filter; // Assuming 'category' is the field in your collection
        }

        const products = await productCollection
          .find(query) // Apply the dynamic filter
          .skip(skip) // Skip the appropriate number of documents
          .limit(limit) // Limit the number of results
          .toArray(); // Convert the result to an array

        res.send(products);
      } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).send({ message: "Error fetching products" });
      }
    });

    app.post("/place-order", async (req, res) => {
      const {
        userDetails: { name, phone, address, note },
        products: cart,
        deliveryCharge,
        totalPrice,
      } = req.body;

      console.log("Request Body:", req.body);

      // Validate the incoming request
      if (
        !name ||
        !phone ||
        !address ||
        !Array.isArray(cart) ||
        cart.length === 0
      ) {
        return res.status(400).json({ message: "All fields are required." });
      }

      // Validate phone number (simple regex for 11-digit number)
      if (!/^\d{11}$/.test(phone)) {
        return res.status(400).json({ message: "Invalid phone number." });
      }

      try {
        const db = client.db("bossbaby");
        const productsCollection = db.collection("allProduct");

        // Check the cart and update stock
        for (let item of cart) {
          const { productId, selectedSize, quantity } = item;

          // Validate productId and size
          if (!ObjectId.isValid(productId) || !selectedSize || !quantity) {
            return res
              .status(400)
              .json({ message: "Invalid product details." });
          }

          const product = await productsCollection.findOne({
            _id: new ObjectId(productId),
          });

          if (!product) {
            return res.status(404).json({ message: "Product not found." });
          }

          const sizeData = product.sizes.find(
            (size) => size.size === selectedSize
          );

          if (!sizeData) {
            return res
              .status(400)
              .json({ message: `Size ${selectedSize} not found.` });
          }

          if (sizeData.stock < quantity) {
            return res.status(400).json({
              message: `Insufficient stock for size ${selectedSize}. Available: ${sizeData.stock}`,
            });
          }

          // Update stock for the selected size
          const updatedSizes = product.sizes.map((size) => {
            if (size.size === selectedSize) {
              return { ...size, stock: size.stock - quantity };
            }
            return size;
          });

          await productsCollection.updateOne(
            { _id: new ObjectId(productId) },
            { $set: { sizes: updatedSizes } }
          );
        }

        // Get the current date and time for the order
        const currentDate = new Date();
        const orderDate = currentDate.toLocaleDateString();
        const orderTime = currentDate.toLocaleTimeString();
        const status = "pending";

        // Create the order object
        const newOrder = {
          name,
          phone,
          address,
          note,
          cart, // Cart details (products, sizes, quantities)
          deliveryCharge,
          totalPrice,
          orderDate,
          orderTime,
          status,
        };
        console.log(newOrder);

        // Insert the new order into the 'orders' collection
        const result = await orderCollection.insertOne(newOrder);
        const orderNumber = result.insertedId;

        // Respond with order number and success message
        res.status(201).json({
          message: "Order placed successfully.",
          orderNumber: orderNumber,
          orderDate,
          orderTime,
        });
      } catch (error) {
        console.error("Error placing the order:", error.message);
        res.status(500).json({ message: "Error placing the order." });
      }
    });

    console.log("Connected to MongoDB successfully!");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  } finally {
    // Do not close the connection as it would stop the server
    // await client.close();
  }
}

// Run the server and establish MongoDB connection
run().catch(console.dir);

// Root API route to check server status
app.get("/", (req, res) => {
  res.send("Server running successfully");
});

// Start the Express server
app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});
