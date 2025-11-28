const pool = require('../../../db');
const bcrypt = require('bcryptjs');

// Create a new customer and associated user
const createCustomer = async (req, res) => {
  const { company_name, email, phone_number, address, established_date, account_holder_name, password } = req.body;

  if (!company_name || !email || !password) {
    return res.status(400).json({ error: 'Company name, email, and password are required' });
  }

  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert into customers_nex_lock with is_approved default true
    const customerResult = await pool.query(
      'INSERT INTO customers_nex_lock (company_name, email, phone_number, is_approved, address, established_date, account_holder_name) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [company_name, email, phone_number, true, address, established_date, account_holder_name]
    );

    const customer = customerResult.rows[0];

    // Insert into users_nex_lock with company_id
    await pool.query(
      'INSERT INTO users_nex_lock (email, password, role, is_superuser, company_id) VALUES ($1, $2, $3, $4, $5)',
      [email, hashedPassword, 'owner', true, customer.id]
    );

    res.status(201).json(customer);
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all customers
const getCustomers = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customers_nex_lock ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get a customer by ID
const getCustomerById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM customers_nex_lock WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update a customer
const updateCustomer = async (req, res) => {
  const { id } = req.params;
  const { company_name, email, phone_number, is_approved, address, established_date, account_holder_name } = req.body;

  try {
    // Get current customer to check if email changed
    const currentResult = await pool.query('SELECT email FROM customers_nex_lock WHERE id = $1', [id]);
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const oldEmail = currentResult.rows[0].email;

    // Update customer
    const result = await pool.query(
      'UPDATE customers_nex_lock SET company_name = $1, email = $2, phone_number = $3, is_approved = $4, address = $5, established_date = $6, account_holder_name = $7 WHERE id = $8 RETURNING *',
      [company_name, email, phone_number, is_approved, address, established_date, account_holder_name, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // If email changed, update users_nex_lock
    if (email && email !== oldEmail) {
      await pool.query('UPDATE users_nex_lock SET email = $1 WHERE email = $2', [email, oldEmail]);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete a customer
const deleteCustomer = async (req, res) => {
  const { id } = req.params;
  try {
    // Get email to delete from users_nex_lock
    const customerResult = await pool.query('SELECT email FROM customers_nex_lock WHERE id = $1', [id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const email = customerResult.rows[0].email;

    // Delete from customers_nex_lock
    await pool.query('DELETE FROM customers_nex_lock WHERE id = $1', [id]);

    // Delete from users_nex_lock
    await pool.query('DELETE FROM users_nex_lock WHERE email = $1', [email]);

    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
};
